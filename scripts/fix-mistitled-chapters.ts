#!/usr/bin/env tsx
/**
 * Fix the residual chapter groups the consolidation script skipped: groups
 * where 3+ chapters in the same subject share the same title.
 *
 * Root cause: CBSE curriculum PDFs were parsed more than once by the scraper,
 * producing both exact-duplicate rows (same topic set) AND legitimately-
 * distinct rows that happen to share a section heading (Theory/Practical/
 * Internal Assessment across three terms, or Apithatavabodhanam across three
 * comprehension units).
 *
 * Two passes:
 *
 *   Pass A — Exact-duplicate merge. Within each group, find chapter pairs
 *            whose topic sets (normalized titles) are identical. Merge the
 *            higher-numbered chapter into the lower-numbered one, repoint
 *            SET-NULL FKs, keep audit trail in metadata.merged_from.
 *
 *   Pass B — Rename collisions. After Pass A, if 2+ chapters in a subject
 *            still share a title, rename the later ones with " (Part II)",
 *            " (Part III)" suffixes (by chapter_number order) so the UI and
 *            breadcrumbs show distinct entries.
 *
 * Dry-run by default. Pass --apply to commit.
 *
 * Usage:
 *   pnpm tsx scripts/fix-mistitled-chapters.ts
 *   pnpm tsx scripts/fix-mistitled-chapters.ts --apply
 */

import { config } from "dotenv";
config({ path: ".env.local", override: true });
config({ path: ".env" });

import { sql } from "drizzle-orm";
import { db } from "../src/db";

const DRY = !process.argv.includes("--apply");

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

function log(msg = "") { console.log(msg); }
function logPlan(msg: string) { console.log(`    ${DRY ? "[plan]" : "[apply]"} ${msg}`); }

function normalizeTopicTitle(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\u0900-\u097f]+/g, " ").trim();
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

// ---------------------------------------------------------------------------
// Load data
// ---------------------------------------------------------------------------

interface ChapterRow {
  id: number;
  subject_id: number;
  subject_name: string;
  grade: number;
  board_code: string;
  chapter_number: number;
  title: string;
  topic_count: number;
  content_count: number;
  [k: string]: unknown;
}

async function loadDupGroups(): Promise<ChapterRow[][]> {
  const rows = (await db.execute<ChapterRow>(sql`
    SELECT c.id::int AS id, c.subject_id::int AS subject_id, s.name AS subject_name,
           st.grade::int AS grade, b.code AS board_code,
           c.chapter_number::int AS chapter_number, c.title,
           (SELECT COUNT(*)::int FROM topics t WHERE t.chapter_id = c.id) AS topic_count,
           (SELECT COUNT(*)::int FROM content_items ci
              JOIN topics t ON t.id = ci.topic_id WHERE t.chapter_id = c.id) AS content_count
    FROM chapters c
    JOIN subjects s ON s.id = c.subject_id
    JOIN standards st ON st.id = s.standard_id
    JOIN boards b ON b.id = st.board_id
    WHERE (c.subject_id, c.title) IN (
      SELECT subject_id, title FROM chapters GROUP BY subject_id, title HAVING COUNT(*) >= 3
    )
    ORDER BY c.subject_id, c.title, c.chapter_number
  `)) as unknown as ChapterRow[];

  const map = new Map<string, ChapterRow[]>();
  for (const r of rows) {
    const key = `${r.subject_id}|${r.title}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(r);
  }
  return [...map.values()];
}

async function loadTopicSets(chapterIds: number[]): Promise<Map<number, Set<string>>> {
  if (chapterIds.length === 0) return new Map();
  const result = new Map<number, Set<string>>();
  for (const id of chapterIds) result.set(id, new Set());
  const idList = sql.join(chapterIds.map((id) => sql`${id}`), sql`,`);
  const rows = await db.execute<{ chapter_id: number; title: string }>(sql`
    SELECT chapter_id::int AS chapter_id, title FROM topics
    WHERE chapter_id IN (${idList})
  `);
  for (const r of rows) {
    result.get(r.chapter_id)!.add(normalizeTopicTitle(r.title));
  }
  return result;
}

// ---------------------------------------------------------------------------
// Pass A — exact-duplicate merge within a group
// ---------------------------------------------------------------------------

const MERGE_THRESHOLD = 0.95;

async function mergePair(winnerId: number, loserId: number, winnerChNum: number, loserChNum: number) {
  await db.transaction(async (tx) => {
    await tx.execute(sql`UPDATE topics SET chapter_id = ${winnerId} WHERE chapter_id = ${loserId}`);
    await tx.execute(sql`UPDATE creator_content SET chapter_id = ${winnerId} WHERE chapter_id = ${loserId}`);
    await tx.execute(sql`UPDATE learning_sessions SET chapter_id = ${winnerId} WHERE chapter_id = ${loserId}`);
    await tx.execute(sql`DELETE FROM chapters WHERE id = ${loserId}`);
    await tx.execute(sql`
      UPDATE chapters SET metadata = COALESCE(metadata, '{}'::jsonb)
        || jsonb_build_object(
          'merged_from',
          COALESCE(metadata->'merged_from', '[]'::jsonb)
            || to_jsonb(jsonb_build_object('id', ${loserId}::int, 'chapter_number', ${loserChNum}::int))
        )
      WHERE id = ${winnerId}
    `);
    void winnerChNum;
  });
}

async function passAMerge(groups: ChapterRow[][]): Promise<{ groups: ChapterRow[][]; pairsMerged: number }> {
  log("\n════════════════════════════════════════════════════════════");
  log(" PASS A — Merge exact-duplicate chapter pairs within a group");
  log("════════════════════════════════════════════════════════════");

  let pairsMerged = 0;
  const survivingGroups: ChapterRow[][] = [];

  for (const g of groups) {
    const head = g[0];
    log(`\n[${head.board_code} Class ${head.grade}] ${head.subject_name} / "${head.title}" (${g.length} chapters)`);
    const topicSets = await loadTopicSets(g.map((c) => c.id));

    const alive = [...g].sort((a, b) => a.chapter_number - b.chapter_number);
    const merged = new Set<number>();

    for (let i = 0; i < alive.length; i++) {
      if (merged.has(alive[i].id)) continue;
      const keeper = alive[i];
      for (let j = i + 1; j < alive.length; j++) {
        if (merged.has(alive[j].id)) continue;
        const cand = alive[j];
        const sim = jaccard(topicSets.get(keeper.id)!, topicSets.get(cand.id)!);
        log(`    pair ch${keeper.chapter_number} ↔ ch${cand.chapter_number}  jaccard=${sim.toFixed(2)}`);
        if (sim >= MERGE_THRESHOLD) {
          logPlan(`merge ch${cand.chapter_number} (#${cand.id}) → ch${keeper.chapter_number} (#${keeper.id})`);
          if (!DRY) await mergePair(keeper.id, cand.id, keeper.chapter_number, cand.chapter_number);
          merged.add(cand.id);
          pairsMerged++;
        }
      }
    }

    const survivors = alive.filter((c) => !merged.has(c.id));
    if (survivors.length >= 2) survivingGroups.push(survivors);
    else log(`    ✓ group resolved to ${survivors.length} chapter(s)`);
  }

  log(`\n  pairs merged=${pairsMerged}  groups remaining for Pass B=${survivingGroups.length}`);
  return { groups: survivingGroups, pairsMerged };
}

// ---------------------------------------------------------------------------
// Pass B — rename collisions with Part suffix
// ---------------------------------------------------------------------------

async function passBRename(groups: ChapterRow[][]): Promise<number> {
  log("\n════════════════════════════════════════════════════════════");
  log(" PASS B — Rename surviving same-title chapters with Part suffix");
  log("════════════════════════════════════════════════════════════");

  let renamed = 0;
  for (const g of groups) {
    const head = g[0];
    log(`\n[${head.board_code} Class ${head.grade}] ${head.subject_name} / "${head.title}" (${g.length} distinct chapters)`);
    const sorted = [...g].sort((a, b) => a.chapter_number - b.chapter_number);

    for (let i = 0; i < sorted.length; i++) {
      const ch = sorted[i];
      const suffix = ROMAN[i] ?? String(i + 1);
      const newTitle = `${ch.title} (Part ${suffix})`;
      log(`    ch${ch.chapter_number} #${ch.id}  "${ch.title}" → "${newTitle}"`);
      logPlan(`UPDATE chapters SET title = ? WHERE id = ${ch.id}`);
      if (!DRY) {
        await db.execute(sql`UPDATE chapters SET title = ${newTitle} WHERE id = ${ch.id}`);
      }
      renamed++;
    }
  }
  log(`\n  chapters renamed=${renamed}`);
  return renamed;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  log("╔══════════════════════════════════════════════════════════╗");
  log(`║       FIX MIS-TITLED CHAPTERS — ${DRY ? "DRY RUN" : "APPLY  "}                ║`);
  log("╚══════════════════════════════════════════════════════════╝");
  if (DRY) log("⚠ DRY RUN — no database changes will be written. Pass --apply to commit.");

  const groups = await loadDupGroups();
  if (groups.length === 0) { log("\n✓ no chapter groups with 3+ same-titled members. Nothing to do."); process.exit(0); }

  log(`\nFound ${groups.length} chapter groups (subject, title) with 3+ members.`);

  const { groups: survivors, pairsMerged } = await passAMerge(groups);
  const renamed = await passBRename(survivors);

  log("\n────────────────────────────────────────────────────────────");
  log(`Summary: pass A merged ${pairsMerged} pairs, pass B renamed ${renamed} chapters.`);
  log(DRY ? "Dry run complete. Re-run with --apply to commit." : "Fixes applied.");
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
