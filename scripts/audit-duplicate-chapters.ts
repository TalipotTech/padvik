#!/usr/bin/env tsx
/**
 * Audit duplicate / non-canonical chapter hierarchies across (board, grade, subject).
 *
 * Problem: some subjects have two overlapping chapter sets in the DB —
 * syllabus-scraped chapters (course-like names, wrong chapter_numbers) and
 * NCERT-derived chapters (matching PDFs). This audit reports the full scope
 * so we can plan a consolidation.
 *
 * Output: one block per subject, showing which chapters are canonical-matched,
 * which are extras, and how topics are distributed.
 *
 * Usage:
 *   pnpm tsx scripts/audit-duplicate-chapters.ts                 # all
 *   pnpm tsx scripts/audit-duplicate-chapters.ts --board CBSE    # one board
 *   pnpm tsx scripts/audit-duplicate-chapters.ts --only-dirty    # only subjects with issues
 */
import { config } from "dotenv";
config({ path: ".env.local", override: true });
config({ path: ".env" });

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { sql } from "drizzle-orm";
import { db } from "../src/db";
import { NCERT_BOOK_CATALOG, getCanonicalSubjectSlug } from "../src/lib/scraper/ncert-downloader";

const TITLE_CACHE_DIR = join(process.cwd(), "data", "ncert-chapter-titles");

function parseArgs(argv: string[]) {
  const val = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    board: val("--board"),
    onlyDirty: argv.includes("--only-dirty"),
  };
}

function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/[’'`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function titleSimilarity(a: string, b: string): number {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const aSet = new Set(na.split(/\s+/));
  const bSet = new Set(nb.split(/\s+/));
  let intersect = 0;
  for (const w of aSet) if (bSet.has(w)) intersect++;
  return intersect / Math.max(aSet.size, bSet.size);
}

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
  topic_count: string;
  content_item_count: string;
}

function loadCanonicalTitles(grade: number, subjectName: string): Record<string, string> | null {
  // Try to match subject against NCERT catalog to find the canonical slug
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
    return JSON.parse(readFileSync(cachePath, "utf8")) as Record<string, string>;
  } catch {
    return null;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // Fetch every (board, grade, subject) triple
  const subjQuery = sql`
    SELECT b.code AS board_code, b.name AS board_name,
           st.grade AS grade,
           s.id AS subject_id, s.name AS subject_name, s.code AS subject_code
    FROM subjects s
    JOIN standards st ON st.id = s.standard_id
    JOIN boards b ON b.id = st.board_id
    ${args.board ? sql`WHERE b.code = ${args.board}` : sql``}
    ORDER BY b.code, st.grade, s.name
  `;
  const subjRaw = await db.execute(subjQuery);
  const subjRows = (Array.isArray(subjRaw) ? subjRaw : (subjRaw as { rows?: SubjectRow[] }).rows ?? []) as SubjectRow[];

  console.log(`\n=== Chapter hierarchy audit (${subjRows.length} subject rows) ===\n`);

  let dirtyCount = 0;
  let cleanCount = 0;
  let noCatalogCount = 0;

  for (const subj of subjRows) {
    const canonical = loadCanonicalTitles(subj.grade, subj.subject_name);

    const chapQuery = sql`
      SELECT c.id, c.chapter_number, c.title,
             (SELECT count(*) FROM topics WHERE chapter_id = c.id) AS topic_count,
             (SELECT count(*) FROM content_items ci JOIN topics t ON t.id = ci.topic_id WHERE t.chapter_id = c.id) AS content_item_count
      FROM chapters c
      WHERE c.subject_id = ${Number(subj.subject_id)}
      ORDER BY c.chapter_number, c.id
    `;
    const chapRaw = await db.execute(chapQuery);
    const chapters = (Array.isArray(chapRaw) ? chapRaw : (chapRaw as { rows?: ChapterRow[] }).rows ?? []) as ChapterRow[];

    if (chapters.length === 0) continue;

    // Classify each chapter as canonical-match / extra
    const classification = chapters.map((ch) => {
      if (!canonical) return { ch, match: null as number | null, score: 0 };
      let bestN: number | null = null;
      let bestScore = 0;
      for (const [n, t] of Object.entries(canonical)) {
        const score = titleSimilarity(ch.title, t);
        if (score > bestScore) {
          bestScore = score;
          bestN = Number(n);
        }
      }
      // Must meet a threshold to count as canonical-matched
      return { ch, match: bestScore >= 0.55 ? bestN : null, score: bestScore };
    });

    const matched = classification.filter((c) => c.match !== null);
    const extras = classification.filter((c) => c.match === null);

    // Is the subject "dirty"?
    // Dirty = has any chapter whose title doesn't match a canonical NCERT title,
    // OR has duplicate matches to the same canonical number,
    // OR has chapter_numbers outside the canonical range when canonical is known.
    const matchCounts: Record<number, number> = {};
    for (const m of matched) {
      if (m.match !== null) matchCounts[m.match] = (matchCounts[m.match] ?? 0) + 1;
    }
    const duplicateMatches = Object.entries(matchCounts).filter(([, n]) => n > 1);

    const isDirty =
      canonical !== null && (extras.length > 0 || duplicateMatches.length > 0);

    if (!canonical) noCatalogCount++;
    else if (isDirty) dirtyCount++;
    else cleanCount++;

    if (args.onlyDirty && !isDirty) continue;
    if (args.onlyDirty && !canonical) continue;

    const status = !canonical ? "NO-CATALOG" : isDirty ? "DIRTY" : "clean";
    console.log(
      `── ${subj.board_code} / Class ${subj.grade} / ${subj.subject_name} [${status}] ` +
        `(${chapters.length} chapters, ${chapters.reduce((a, c) => a + Number(c.topic_count), 0)} topics)`
    );

    if (!canonical) {
      console.log(`    (no canonical title cache available)`);
      for (const ch of chapters) {
        console.log(
          `    #${ch.chapter_number.toString().padStart(2, " ")} "${ch.title}" — ${ch.topic_count} topics, ${ch.content_item_count} CIs`
        );
      }
      console.log("");
      continue;
    }

    console.log(`    Matched (${matched.length}):`);
    for (const m of matched) {
      const canonicalTitle = canonical[String(m.match)];
      console.log(
        `      NCERT ch${m.match!.toString().padStart(2, "0")} "${canonicalTitle}" ← ` +
          `DB ch${m.ch.chapter_number} "${m.ch.title}" (sim=${m.score.toFixed(2)}, ${m.ch.topic_count} topics)`
      );
    }
    if (duplicateMatches.length > 0) {
      console.log(`    ⚠ Duplicate canonical matches: ${duplicateMatches.map(([n, c]) => `ch${n}×${c}`).join(", ")}`);
    }
    const missing = Object.keys(canonical)
      .map(Number)
      .filter((n) => !matchCounts[n]);
    if (missing.length > 0) {
      console.log(`    ⚠ Missing canonical NCERT chapters in DB: ${missing.map((n) => `ch${n}`).join(", ")}`);
    }
    if (extras.length > 0) {
      console.log(`    Extras (${extras.length} — NOT in canonical NCERT list):`);
      for (const e of extras) {
        console.log(
          `      DB ch${e.ch.chapter_number} "${e.ch.title}" ` +
            `(bestSim=${e.score.toFixed(2)}, ${e.ch.topic_count} topics, ${e.ch.content_item_count} CIs)`
        );
      }
    }
    console.log("");
  }

  console.log("=== Summary ===");
  console.log(`  clean subjects:      ${cleanCount}`);
  console.log(`  DIRTY subjects:      ${dirtyCount}`);
  console.log(`  no-catalog subjects: ${noCatalogCount}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
