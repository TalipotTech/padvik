#!/usr/bin/env tsx
/**
 * Consolidate duplicate / non-canonical chapter hierarchies by reparenting
 * topics onto canonical NCERT chapters and removing the redundant syllabus
 * chapters.
 *
 * Problem: for subjects with a canonical NCERT chapter-title cache (under
 * data/ncert-chapter-titles/), the DB often has BOTH a canonical set (chapters
 * matching NCERT titles) and an EXTRA set (syllabus units like "Algebra",
 * "Mathematics Standard"). Topics are split across both, so content enrichment
 * fails and the student view shows "Content being prepared".
 *
 * This script:
 *   1. Ensures every canonical NCERT chapter exists in DB with the right
 *      title + chapter_number. Renames/renumbers matched chapters; creates
 *      stubs for missing ones.
 *   2. Reparents each topic under an extra chapter onto the NCERT chapter
 *      whose title best matches the topic title (via Jaccard-style word
 *      similarity). Topics below the similarity threshold are left on a
 *      renamed "Unmapped Topics" parking chapter (chapter_number 99) for
 *      manual review.
 *   3. Deletes empty extras. Repoints creator_content / learning_sessions
 *      if needed (they already have SET NULL, so nothing to do explicitly).
 *
 * Usage:
 *   pnpm tsx scripts/consolidate-chapter-hierarchy.ts --dry-run        # print plan, no writes
 *   pnpm tsx scripts/consolidate-chapter-hierarchy.ts --apply          # execute
 *   pnpm tsx scripts/consolidate-chapter-hierarchy.ts --apply --board CBSE --grade 10 --subject Mathematics
 *
 * Required: --dry-run OR --apply (explicit, no default).
 *
 * Safe to re-run — idempotent. Runs per-subject in a transaction so partial
 * failures don't corrupt other subjects.
 */
import { config } from "dotenv";
config({ path: ".env.local", override: true });
config({ path: ".env" });

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { sql } from "drizzle-orm";
import { db } from "../src/db";
import { NCERT_BOOK_CATALOG, getCanonicalSubjectSlug } from "../src/lib/scraper/ncert-downloader";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const TITLE_CACHE_DIR = join(process.cwd(), "data", "ncert-chapter-titles");

/** Minimum similarity between DB chapter title and canonical NCERT title to count as "matched". */
const CHAPTER_MATCH_THRESHOLD = 0.55;
/** Minimum similarity between topic title and canonical NCERT chapter title to reparent. */
const TOPIC_REPARENT_THRESHOLD = 0.40;
/** Parking chapter_number for unmapped topics (high, outside any real NCERT range). */
const UNMAPPED_CHAPTER_NUMBER = 99;

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface Args {
  dryRun: boolean;
  apply: boolean;
  board?: string;
  grade?: number;
  subject?: string;
}

function parseArgs(argv: string[]): Args {
  const val = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const args: Args = {
    dryRun: argv.includes("--dry-run"),
    apply: argv.includes("--apply"),
    board: val("--board"),
    grade: val("--grade") ? Number(val("--grade")) : undefined,
    subject: val("--subject"),
  };
  if (!args.dryRun && !args.apply) {
    console.error("Must pass --dry-run or --apply");
    process.exit(1);
  }
  if (args.dryRun && args.apply) {
    console.error("Cannot pass both --dry-run and --apply");
    process.exit(1);
  }
  return args;
}

// ---------------------------------------------------------------------------
// Similarity
// ---------------------------------------------------------------------------

function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/[’'`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Stopwords to drop from Jaccard similarity — low-information words that
 * otherwise cause spurious matches like "Introduction to Statistics" ↔
 * "Introduction to Trigonometry" or "Health and Diseases" ↔ "Atoms and
 * Molecules".
 */
const STOPWORDS = new Set([
  "a", "an", "and", "the", "of", "to", "in", "on", "at", "for", "with", "or",
  "into", "from", "as", "by", "is", "are", "be",
  "introduction", "basic", "chapter", "content", "part",
  "some", "all",
]);

/** Strip trailing 's' for a crude plural stem (numbers→number, diseases→disease). */
function stem(w: string): string {
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") && !w.endsWith("us") && !w.endsWith("is")) {
    return w.slice(0, -1);
  }
  return w;
}

function tokens(s: string): Set<string> {
  return new Set(
    normalizeTitle(s)
      .split(/\s+/)
      .filter((w) => w.length > 1 && !STOPWORDS.has(w))
      .map(stem)
  );
}

/** Jaccard similarity over stemmed, stopword-filtered tokens. */
function titleSimilarity(a: string, b: string): number {
  const aSet = tokens(a);
  const bSet = tokens(b);
  if (aSet.size === 0 || bSet.size === 0) return 0;
  let intersect = 0;
  for (const w of aSet) if (bSet.has(w)) intersect++;
  return intersect / Math.max(aSet.size, bSet.size);
}

// ---------------------------------------------------------------------------
// Canonical title loading
// ---------------------------------------------------------------------------

function loadCanonicalTitles(
  grade: number,
  subjectName: string
): Record<number, string> | null {
  const book = NCERT_BOOK_CATALOG.find(
    (b) =>
      b.grade === grade &&
      b.language === "en" &&
      b.subject.toLowerCase() === subjectName.toLowerCase()
  );
  if (!book) return null;
  const slug = getCanonicalSubjectSlug(book.code);
  const cachePath = join(TITLE_CACHE_DIR, `${grade}-${slug}.json`);
  if (!existsSync(cachePath)) return null;
  try {
    const raw = JSON.parse(readFileSync(cachePath, "utf8")) as Record<string, string>;
    const out: Record<number, string> = {};
    for (const [k, v] of Object.entries(raw)) out[Number(k)] = v;
    return out;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SubjectRow {
  board_code: string;
  board_name: string;
  grade: number;
  subject_id: string;
  subject_name: string;
  subject_code: string;
}

interface ChapterRow {
  id: string;
  chapter_number: number;
  title: string;
  sort_order: number;
  metadata: unknown;
}

interface TopicRow {
  id: string;
  title: string;
  chapter_id: string;
}

/** Per-subject plan. */
interface Plan {
  subjectId: number;
  subjectLabel: string; // "CBSE / Class 10 / Mathematics"
  /** Canonical N → action to take */
  canonicalActions: Map<
    number,
    | { kind: "rename-renumber"; dbChapterId: number; fromTitle: string; fromNumber: number; toTitle: string }
    | { kind: "create"; toTitle: string }
    | { kind: "merge-duplicates"; winnerId: number; loserIds: number[]; toTitle: string; fromNumber: number }
  >;
  /** Topics to reparent: topicId → target canonical chapter number */
  reparents: Array<{ topicId: number; topicTitle: string; fromChapterId: number; fromChapterTitle: string; toCanonicalN: number; toTitle: string; score: number }>;
  /** Topics that couldn't be reparented (left on a parking chapter). */
  unmapped: Array<{ topicId: number; topicTitle: string; fromChapterId: number; fromChapterTitle: string; bestScore: number }>;
  /** Extra chapters that will be deleted (empty after reparent). */
  toDelete: Array<{ id: number; title: string; chapterNumber: number }>;
  /** Extra chapters that will become the parking chapter (has unmapped topics). */
  parkingChapter: { id: number; title: string; chapterNumber: number } | null;
}

// ---------------------------------------------------------------------------
// Plan builder
// ---------------------------------------------------------------------------

async function buildPlan(subj: SubjectRow): Promise<Plan | null> {
  const canonical = loadCanonicalTitles(subj.grade, subj.subject_name);
  if (!canonical) return null;

  const subjectId = Number(subj.subject_id);
  const subjectLabel = `${subj.board_code} / Class ${subj.grade} / ${subj.subject_name}`;

  const chapRaw = await db.execute(sql`
    SELECT id, chapter_number, title, sort_order, metadata
    FROM chapters WHERE subject_id = ${subjectId}
    ORDER BY chapter_number, id
  `);
  const chapters = ((Array.isArray(chapRaw) ? chapRaw : (chapRaw as { rows?: ChapterRow[] }).rows ?? []) as ChapterRow[]);

  const topicRaw = await db.execute(sql`
    SELECT t.id, t.title, t.chapter_id
    FROM topics t
    JOIN chapters c ON c.id = t.chapter_id
    WHERE c.subject_id = ${subjectId}
    ORDER BY t.id
  `);
  const topics = ((Array.isArray(topicRaw) ? topicRaw : (topicRaw as { rows?: TopicRow[] }).rows ?? []) as TopicRow[]);

  // Classify each chapter: best canonical match
  const classified = chapters.map((ch) => {
    let bestN: number | null = null;
    let bestScore = 0;
    for (const [n, t] of Object.entries(canonical)) {
      const score = titleSimilarity(ch.title, t);
      if (score > bestScore) {
        bestScore = score;
        bestN = Number(n);
      }
    }
    return {
      ch,
      matchN: bestScore >= CHAPTER_MATCH_THRESHOLD ? bestN : null,
      score: bestScore,
    };
  });

  // Group by canonical N; resolve duplicates
  const byCanonicalN = new Map<number, Array<{ ch: ChapterRow; score: number }>>();
  for (const c of classified) {
    if (c.matchN !== null) {
      if (!byCanonicalN.has(c.matchN)) byCanonicalN.set(c.matchN, []);
      byCanonicalN.get(c.matchN)!.push({ ch: c.ch, score: c.score });
    }
  }

  const canonicalActions: Plan["canonicalActions"] = new Map();

  for (const [n, matches] of byCanonicalN.entries()) {
    const canonicalTitle = canonical[n];
    if (matches.length === 1) {
      const m = matches[0];
      canonicalActions.set(n, {
        kind: "rename-renumber",
        dbChapterId: Number(m.ch.id),
        fromTitle: m.ch.title,
        fromNumber: m.ch.chapter_number,
        toTitle: canonicalTitle,
      });
    } else {
      // Duplicate matches: keep the one with most topics as winner, merge others
      const topicCountPerCh: Record<number, number> = {};
      for (const m of matches) topicCountPerCh[Number(m.ch.id)] = 0;
      for (const t of topics) {
        const cid = Number(t.chapter_id);
        if (cid in topicCountPerCh) topicCountPerCh[cid]++;
      }
      const sorted = matches.slice().sort((a, b) => {
        const da = topicCountPerCh[Number(a.ch.id)] ?? 0;
        const db_ = topicCountPerCh[Number(b.ch.id)] ?? 0;
        if (da !== db_) return db_ - da;
        return b.score - a.score;
      });
      const winner = sorted[0];
      const losers = sorted.slice(1);
      canonicalActions.set(n, {
        kind: "merge-duplicates",
        winnerId: Number(winner.ch.id),
        loserIds: losers.map((l) => Number(l.ch.id)),
        toTitle: canonicalTitle,
        fromNumber: winner.ch.chapter_number,
      });
    }
  }

  // Missing canonical chapters → create
  for (const [n, title] of Object.entries(canonical)) {
    const nNum = Number(n);
    if (!canonicalActions.has(nNum)) {
      canonicalActions.set(nNum, { kind: "create", toTitle: title });
    }
  }

  // Build set of "extra" chapter IDs (not matched to any canonical)
  const matchedChapterIds = new Set<number>();
  for (const action of canonicalActions.values()) {
    if (action.kind === "rename-renumber") matchedChapterIds.add(action.dbChapterId);
    if (action.kind === "merge-duplicates") {
      matchedChapterIds.add(action.winnerId);
      // loserIds are EXTRA — their topics need reparenting into winner
    }
  }
  const extraChapters = chapters.filter((ch) => !matchedChapterIds.has(Number(ch.id)));

  // For each topic under an extra, find best-match canonical chapter by topic title
  // Also merge-duplicate losers' topics → go to their canonical N automatically.
  const reparents: Plan["reparents"] = [];
  const unmapped: Plan["unmapped"] = [];

  const loserToCanonicalN = new Map<number, number>();
  for (const [n, action] of canonicalActions.entries()) {
    if (action.kind === "merge-duplicates") {
      for (const lid of action.loserIds) loserToCanonicalN.set(lid, n);
    }
  }

  const extraIdSet = new Set(extraChapters.map((ch) => Number(ch.id)));
  const allNonCanonicalIds = new Set<number>([...extraIdSet, ...loserToCanonicalN.keys()]);

  for (const t of topics) {
    const cid = Number(t.chapter_id);
    if (!allNonCanonicalIds.has(cid)) continue; // already under a canonical-matched chapter

    // If from a merge-loser, its target is fixed
    if (loserToCanonicalN.has(cid)) {
      const toN = loserToCanonicalN.get(cid)!;
      reparents.push({
        topicId: Number(t.id),
        topicTitle: t.title,
        fromChapterId: cid,
        fromChapterTitle: chapters.find((c) => Number(c.id) === cid)?.title ?? "?",
        toCanonicalN: toN,
        toTitle: canonical[toN],
        score: 1.0, // merged, perfect
      });
      continue;
    }

    // Otherwise find best canonical match by topic title
    let bestN: number | null = null;
    let bestScore = 0;
    for (const [n, ct] of Object.entries(canonical)) {
      const s = titleSimilarity(t.title, ct);
      if (s > bestScore) {
        bestScore = s;
        bestN = Number(n);
      }
    }
    const fromCh = chapters.find((c) => Number(c.id) === cid)!;
    if (bestN !== null && bestScore >= TOPIC_REPARENT_THRESHOLD) {
      reparents.push({
        topicId: Number(t.id),
        topicTitle: t.title,
        fromChapterId: cid,
        fromChapterTitle: fromCh.title,
        toCanonicalN: bestN,
        toTitle: canonical[bestN],
        score: bestScore,
      });
    } else {
      unmapped.push({
        topicId: Number(t.id),
        topicTitle: t.title,
        fromChapterId: cid,
        fromChapterTitle: fromCh.title,
        bestScore,
      });
    }
  }

  // Decide deletion / parking
  // After reparents, which extras have topics remaining? Those become parking candidates.
  const topicsRemainingByChapter: Record<number, number> = {};
  for (const t of topics) {
    const cid = Number(t.chapter_id);
    if (allNonCanonicalIds.has(cid)) {
      topicsRemainingByChapter[cid] = (topicsRemainingByChapter[cid] ?? 0) + 1;
    }
  }
  const reparentedByChapter: Record<number, number> = {};
  for (const r of reparents) {
    reparentedByChapter[r.fromChapterId] = (reparentedByChapter[r.fromChapterId] ?? 0) + 1;
  }
  const finalTopicsByChapter: Record<number, number> = {};
  for (const cid of allNonCanonicalIds) {
    finalTopicsByChapter[cid] =
      (topicsRemainingByChapter[cid] ?? 0) - (reparentedByChapter[cid] ?? 0);
  }

  // Chapters with 0 remaining → delete.
  // Chapters with >0 remaining → repoint topics to a single parking chapter
  // (reuse one existing extra as the parking chapter).
  const toDelete: Plan["toDelete"] = [];
  let parkingChapter: Plan["parkingChapter"] = null;

  for (const cid of allNonCanonicalIds) {
    const ch = chapters.find((c) => Number(c.id) === cid)!;
    const remaining = finalTopicsByChapter[cid];
    if (remaining === 0) {
      toDelete.push({ id: cid, title: ch.title, chapterNumber: ch.chapter_number });
    } else if (remaining > 0) {
      // Pick the first one as parking chapter; move remaining unmapped topics from
      // the others into it too.
      if (!parkingChapter) {
        parkingChapter = { id: cid, title: ch.title, chapterNumber: ch.chapter_number };
      } else {
        // Move unmapped topics from this chapter into the parking chapter, then delete it
        for (const u of unmapped) {
          if (u.fromChapterId === cid) {
            // Handled in apply: we'll UPDATE topic chapter_id = parking.id for all unmapped
          }
        }
        toDelete.push({ id: cid, title: ch.title, chapterNumber: ch.chapter_number });
      }
    }
  }

  return {
    subjectId,
    subjectLabel,
    canonicalActions,
    reparents,
    unmapped,
    toDelete,
    parkingChapter,
  };
}

// ---------------------------------------------------------------------------
// Plan printer
// ---------------------------------------------------------------------------

function printPlan(plan: Plan): void {
  console.log(`\n── ${plan.subjectLabel}`);
  console.log(`  Canonical actions:`);
  const ns = Array.from(plan.canonicalActions.keys()).sort((a, b) => a - b);
  for (const n of ns) {
    const a = plan.canonicalActions.get(n)!;
    if (a.kind === "rename-renumber") {
      const changes: string[] = [];
      if (a.fromTitle !== a.toTitle) changes.push(`rename "${a.fromTitle}" → "${a.toTitle}"`);
      if (a.fromNumber !== n) changes.push(`renumber ch${a.fromNumber} → ch${n}`);
      if (changes.length === 0) changes.push("no change");
      console.log(`    ch${n.toString().padStart(2, "0")} [id ${a.dbChapterId}]: ${changes.join(", ")}`);
    } else if (a.kind === "create") {
      console.log(`    ch${n.toString().padStart(2, "0")}: CREATE "${a.toTitle}" (stub)`);
    } else if (a.kind === "merge-duplicates") {
      console.log(
        `    ch${n.toString().padStart(2, "0")} [id ${a.winnerId}]: rename to "${a.toTitle}", MERGE losers [${a.loserIds.join(", ")}]`
      );
    }
  }

  if (plan.reparents.length > 0) {
    console.log(`  Topic reparents (${plan.reparents.length}):`);
    for (const r of plan.reparents.slice(0, 50)) {
      console.log(
        `    topic ${r.topicId} "${r.topicTitle}" [from "${r.fromChapterTitle}"] → ch${r.toCanonicalN} "${r.toTitle}" (sim=${r.score.toFixed(2)})`
      );
    }
    if (plan.reparents.length > 50) console.log(`    … (${plan.reparents.length - 50} more)`);
  }

  if (plan.unmapped.length > 0) {
    console.log(`  Unmapped topics (will move to parking chapter): ${plan.unmapped.length}`);
    for (const u of plan.unmapped.slice(0, 20)) {
      console.log(
        `    topic ${u.topicId} "${u.topicTitle}" [from "${u.fromChapterTitle}"] (bestSim=${u.bestScore.toFixed(2)})`
      );
    }
    if (plan.unmapped.length > 20) console.log(`    … (${plan.unmapped.length - 20} more)`);
    if (plan.parkingChapter) {
      console.log(
        `    → parking chapter: id ${plan.parkingChapter.id} "${plan.parkingChapter.title}" renamed to "Unmapped Topics (review)" at ch${UNMAPPED_CHAPTER_NUMBER}`
      );
    }
  }

  if (plan.toDelete.length > 0) {
    console.log(`  Chapters to DELETE (${plan.toDelete.length}):`);
    for (const d of plan.toDelete) {
      console.log(`    ch${d.chapterNumber} [id ${d.id}] "${d.title}"`);
    }
  }
}

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

async function applyPlan(plan: Plan): Promise<void> {
  await db.transaction(async (tx) => {
    // PHASE 0: move all chapters in this subject to negative temp chapter_numbers
    // (unique per id) to bypass the (subject_id, chapter_number) uniqueness
    // constraint while we shuffle.
    await tx.execute(sql`
      UPDATE chapters SET chapter_number = -id::smallint
      WHERE subject_id = ${plan.subjectId}
    `);

    // PHASE 1: execute canonical actions
    const ns = Array.from(plan.canonicalActions.keys()).sort((a, b) => a - b);
    const canonicalIdByN = new Map<number, number>();

    for (const n of ns) {
      const a = plan.canonicalActions.get(n)!;
      if (a.kind === "rename-renumber") {
        await tx.execute(sql`
          UPDATE chapters
          SET title = ${a.toTitle},
              chapter_number = ${n}::smallint,
              sort_order = ${n}::smallint
          WHERE id = ${a.dbChapterId}
        `);
        canonicalIdByN.set(n, a.dbChapterId);
      } else if (a.kind === "create") {
        const inserted = await tx.execute(sql`
          INSERT INTO chapters (subject_id, chapter_number, title, sort_order, metadata, created_at)
          VALUES (${plan.subjectId}, ${n}::smallint, ${a.toTitle}, ${n}::smallint, '{}'::jsonb, NOW())
          RETURNING id
        `);
        const rows = (Array.isArray(inserted) ? inserted : (inserted as { rows?: Array<{ id: string }> }).rows ?? []) as Array<{ id: string | number }>;
        const newId = Number(rows[0]?.id);
        if (!newId) throw new Error(`Failed to create canonical chapter ${n} for subject ${plan.subjectId}`);
        canonicalIdByN.set(n, newId);
      } else if (a.kind === "merge-duplicates") {
        // Move topics from losers onto winner first
        for (const lid of a.loserIds) {
          await tx.execute(sql`UPDATE topics SET chapter_id = ${a.winnerId} WHERE chapter_id = ${lid}`);
          await tx.execute(sql`UPDATE creator_content SET chapter_id = ${a.winnerId} WHERE chapter_id = ${lid}`);
          await tx.execute(sql`UPDATE learning_sessions SET chapter_id = ${a.winnerId} WHERE chapter_id = ${lid}`);
          await tx.execute(sql`DELETE FROM chapters WHERE id = ${lid}`);
        }
        // Rename + renumber winner
        await tx.execute(sql`
          UPDATE chapters
          SET title = ${a.toTitle},
              chapter_number = ${n}::smallint,
              sort_order = ${n}::smallint
          WHERE id = ${a.winnerId}
        `);
        canonicalIdByN.set(n, a.winnerId);
      }
    }

    // PHASE 2: reparent topics from extras onto canonical chapters
    for (const r of plan.reparents) {
      const targetId = canonicalIdByN.get(r.toCanonicalN);
      if (!targetId) throw new Error(`No canonical chapter id for N=${r.toCanonicalN}`);
      await tx.execute(sql`
        UPDATE topics SET chapter_id = ${targetId} WHERE id = ${r.topicId}
      `);
    }

    // PHASE 3: parking chapter — move unmapped topics onto it, rename it
    if (plan.parkingChapter && plan.unmapped.length > 0) {
      // Move all unmapped topics (across multiple extras) onto the single parking chapter
      const unmappedTopicIds = plan.unmapped.map((u) => u.topicId);
      if (unmappedTopicIds.length > 0) {
        const idList = sql.join(unmappedTopicIds.map((id) => sql`${id}`), sql`,`);
        await tx.execute(sql`
          UPDATE topics SET chapter_id = ${plan.parkingChapter.id}
          WHERE id IN (${idList})
        `);
      }
      await tx.execute(sql`
        UPDATE chapters
        SET title = 'Unmapped Topics (review)',
            chapter_number = ${UNMAPPED_CHAPTER_NUMBER}::smallint,
            sort_order = ${UNMAPPED_CHAPTER_NUMBER}::smallint,
            metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{consolidation}', '"parking"'::jsonb, true)
        WHERE id = ${plan.parkingChapter.id}
      `);
    }

    // PHASE 4: delete empty extras
    for (const d of plan.toDelete) {
      // Skip the parking chapter if it's somehow in the delete list
      if (plan.parkingChapter && plan.parkingChapter.id === d.id) continue;
      // Safety: ensure no topics still reference this chapter
      const check = await tx.execute(sql`SELECT COUNT(*)::int AS c FROM topics WHERE chapter_id = ${d.id}`);
      const crows = (Array.isArray(check) ? check : (check as { rows?: Array<{ c: number }> }).rows ?? []) as Array<{ c: number }>;
      if ((crows[0]?.c ?? 0) > 0) {
        throw new Error(`Refusing to delete chapter ${d.id} — still has topics`);
      }
      await tx.execute(sql`DELETE FROM chapters WHERE id = ${d.id}`);
    }
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const whereClauses: ReturnType<typeof sql>[] = [];
  if (args.board) whereClauses.push(sql`b.code = ${args.board}`);
  if (args.grade) whereClauses.push(sql`st.grade = ${args.grade}`);
  if (args.subject) whereClauses.push(sql`s.name = ${args.subject}`);
  const where = whereClauses.length > 0 ? sql`WHERE ${sql.join(whereClauses, sql` AND `)}` : sql``;

  const raw = await db.execute(sql`
    SELECT b.code AS board_code, b.name AS board_name,
           st.grade AS grade,
           s.id AS subject_id, s.name AS subject_name, s.code AS subject_code
    FROM subjects s
    JOIN standards st ON st.id = s.standard_id
    JOIN boards b ON b.id = st.board_id
    ${where}
    ORDER BY b.code, st.grade, s.name
  `);
  const subjects = ((Array.isArray(raw) ? raw : (raw as { rows?: SubjectRow[] }).rows ?? []) as SubjectRow[]);

  console.log(`Mode: ${args.dryRun ? "DRY-RUN" : "APPLY"}`);
  console.log(`Inspecting ${subjects.length} subject(s)...\n`);

  let plannedCount = 0;
  let appliedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (const subj of subjects) {
    const plan = await buildPlan(subj);
    if (!plan) {
      skippedCount++;
      continue;
    }

    // Skip subjects with no work to do
    const hasWork =
      Array.from(plan.canonicalActions.values()).some((a) => {
        if (a.kind === "create") return true;
        if (a.kind === "merge-duplicates") return true;
        if (a.kind === "rename-renumber") {
          // We need canonical title lookup for the current canonical N
          return true; // always print matches so user sees the plan
        }
        return false;
      }) ||
      plan.reparents.length > 0 ||
      plan.unmapped.length > 0 ||
      plan.toDelete.length > 0;

    if (!hasWork) {
      skippedCount++;
      continue;
    }

    printPlan(plan);
    plannedCount++;

    if (args.apply) {
      try {
        await applyPlan(plan);
        console.log(`  ✓ applied`);
        appliedCount++;
      } catch (err) {
        console.error(`  ✗ FAILED: ${err instanceof Error ? err.message : String(err)}`);
        errorCount++;
      }
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`  subjects with work:  ${plannedCount}`);
  console.log(`  subjects skipped:    ${skippedCount} (no canonical cache or no work)`);
  if (args.apply) {
    console.log(`  applied:             ${appliedCount}`);
    console.log(`  errors:              ${errorCount}`);
  } else {
    console.log(`  (dry-run — no changes written)`);
  }
  process.exit(errorCount > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
