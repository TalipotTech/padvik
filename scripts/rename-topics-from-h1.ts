#!/usr/bin/env tsx
/**
 * Rename default "Chapter N Content" topic titles using the H1 heading
 * from the AI-extracted content_items.body (the Gemini Vision notes always
 * start with a `# Chapter Title` line).
 *
 * Scope: any topic whose current title matches `^Chapter \d+ Content$` and
 * whose content_item body has a parseable H1. Safe to run repeatedly.
 *
 * Usage:
 *   pnpm tsx scripts/rename-topics-from-h1.ts               # all grades
 *   pnpm tsx scripts/rename-topics-from-h1.ts --grade 10
 *   pnpm tsx scripts/rename-topics-from-h1.ts --grade 10 --dry-run
 */
import { config } from "dotenv";
config({ path: ".env.local", override: true });
config({ path: ".env" });

import { sql } from "drizzle-orm";
import { db } from "../src/db";

function parseArgs(argv: string[]) {
  const val = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    grade: val("--grade") ? Number(val("--grade")) : undefined,
    dryRun: argv.includes("--dry-run"),
  };
}

// Word-numbers 1..30 (covers NCERT book-level chapter counts, plus wider-range textbooks).
// NCERT Physics/Chemistry Part II PDFs spell the chapter-number word first ("Chapter Nine" /
// "Chapter Fourteen") and put the real topic title on the next visual line, which the H1
// extractor may or may not catch — if it DIDN'T, we'd be stuck with a useless "Chapter Nine"
// title unless we strip the word-number prefix too.
const CHAPTER_NUM_WORD =
  "(?:\\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|(?:twenty|thirty)(?:[\\s-](?:one|two|three|four|five|six|seven|eight|nine))?)";

// Convert ALL-CAPS H1 text to Title Case. Keeps short function words lowercase unless
// they're the first or last word. Only invoked when the extracted title has zero
// lowercase letters — so mixed-case/proper-case titles from clean PDFs pass through untouched.
function toTitleCase(s: string): string {
  const lower = new Set(["a","an","the","and","or","but","nor","of","in","on","at","to","for","from","by","with","as","is"]);
  const words = s.split(/\s+/);
  return words
    .map((w, i) => {
      const key = w.toLowerCase().replace(/[^a-z]/g, "");
      const isFirstOrLast = i === 0 || i === words.length - 1;
      if (!isFirstOrLast && lower.has(key)) return w.toLowerCase();
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(" ");
}

function extractH1(body: string): string | null {
  if (!body) return null;
  // First H1 heading in the markdown body
  const m = body.match(/^#\s+(.+?)\s*$/m);
  if (!m) return null;
  let title = m[1].trim();
  // Strip leading "Chapter N:" / "Chapter N -" / "Chapter Nine" prefixes if any
  const stripRe = new RegExp(`^chapter\\s+${CHAPTER_NUM_WORD}\\b[:\\-\\u2014\\s]*`, "i");
  title = title.replace(stripRe, "").trim();
  // Strip stray leading digit-only prefix ("7 ENVIRONMENT..." → "ENVIRONMENT..."). Only
  // digits — never word-numbers — so real titles like "Five Rivers of India" survive.
  title = title.replace(/^\d+[:\-\u2014\s]+/, "").trim();
  // Also handle "Unit N:" style prefixes (some Chemistry PDFs use this)
  title = title.replace(/^unit\s+\d+[:\-\u2014\s]+/i, "").trim();
  // Reject if the extracted title is still just "Chapter N" (digit or word) or obviously default
  const rejectRe = new RegExp(`^chapter\\s+${CHAPTER_NUM_WORD}\\b`, "i");
  if (rejectRe.test(title)) return null;
  if (title.length < 3) return null;
  if (title.length > 200) return null;
  // ALL-CAPS H1s (common when PDF extraction preserves heading styling) → Title Case.
  if (/[A-Z]/.test(title) && !/[a-z]/.test(title)) {
    title = toTitleCase(title);
  }
  return title;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`\n=== Rename default topics from content H1 (${args.dryRun ? "DRY RUN" : "LIVE"}) ===`);
  console.log(`grade=${args.grade ?? "(all)"}\n`);

  const gradeFilter = args.grade ? sql`AND st.grade = ${args.grade}` : sql``;

  // Pull default-named topics along with their content_item body.
  // A topic may have multiple content_items; pick the highest-quality note body.
  const r = await db.execute(sql`
    SELECT
      t.id AS topic_id,
      t.title AS topic_title,
      c.chapter_number,
      c.title AS chapter_title,
      s.name AS subject_name,
      st.grade,
      (SELECT ci.body
         FROM content_items ci
        WHERE ci.topic_id = t.id
          AND ci.content_type = 'note'
          AND length(ci.body) > 200
        ORDER BY ci.quality_score DESC NULLS LAST, ci.id ASC
        LIMIT 1) AS body
    FROM topics t
    JOIN chapters c ON c.id = t.chapter_id
    JOIN subjects s ON s.id = c.subject_id
    JOIN standards st ON st.id = s.standard_id
    WHERE t.title ~ '^Chapter [0-9]+ Content$'
      ${gradeFilter}
    ORDER BY st.grade, s.name, c.chapter_number, t.id
  `);
  const rows = (Array.isArray(r) ? r : (r as { rows?: Array<{
    topic_id: string;
    topic_title: string;
    chapter_number: number;
    chapter_title: string;
    subject_name: string;
    grade: number;
    body: string | null;
  }> }).rows ?? []) as Array<{
    topic_id: string;
    topic_title: string;
    chapter_number: number;
    chapter_title: string;
    subject_name: string;
    grade: number;
    body: string | null;
  }>;

  console.log(`Found ${rows.length} default-named topics to consider\n`);

  let renamed = 0;
  let chapterRenamed = 0;
  let skipped = 0;
  let byGrade: Record<number, number> = {};

  for (const r of rows) {
    const h1 = extractH1(r.body ?? "");
    if (!h1) {
      console.log(`  ⚠ Gr${r.grade} ${r.subject_name} ch${r.chapter_number} topic ${r.topic_id}: no H1 in body, skipping`);
      skipped++;
      continue;
    }

    console.log(`  Gr${r.grade} ${r.subject_name} ch${r.chapter_number} topic ${r.topic_id}: "${r.topic_title}" → "${h1}"`);
    if (!args.dryRun) {
      await db.execute(sql`UPDATE topics SET title = ${h1} WHERE id = ${Number(r.topic_id)}`);
      // Also rename the chapter if it still carries a default "{Book} — Chapter N" / "Chapter N" style title
      const chapterIsDefault = /^.*(?:—|-)\s*Chapter\s+\d+\s*$/i.test(r.chapter_title) || /^Chapter\s+\d+\s*$/i.test(r.chapter_title);
      if (chapterIsDefault) {
        await db.execute(sql`
          UPDATE chapters SET title = ${h1}
          WHERE chapter_number = ${r.chapter_number}
            AND subject_id = (SELECT c.subject_id FROM chapters c JOIN topics tt ON tt.chapter_id = c.id WHERE tt.id = ${Number(r.topic_id)})
            AND title = ${r.chapter_title}
        `);
        console.log(`    ↳ chapter "${r.chapter_title}" → "${h1}"`);
        chapterRenamed++;
      }
    }
    renamed++;
    byGrade[r.grade] = (byGrade[r.grade] ?? 0) + 1;
  }

  console.log(`\n=== Summary ===`);
  console.log(`  topics renamed:   ${renamed}`);
  console.log(`  chapters renamed: ${chapterRenamed}`);
  console.log(`  skipped (no H1):  ${skipped}`);
  console.log(`  by grade: ${JSON.stringify(byGrade)}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
