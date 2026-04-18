#!/usr/bin/env tsx
/**
 * Bootstrap core NCERT content for a given grade+subject set.
 *
 * Pipeline per subject:
 *   1. runNcertDownload — downloads PDFs + AI-extracts content into content_items
 *      (uses existing rate limiting, retries, quality scoring, dedup by source_url).
 *   2. Post-pass: rename default "Chapter N Content" topic titles to match their
 *      canonical NCERT chapter title (from data/ncert-chapter-titles cache, falling
 *      back to the chapter's own `title` column if the cache is absent).
 *
 * Safe to re-run — runNcertDownload dedupes by source_url (the HTTPS NCERT URL),
 * so already-parsed chapters skip the AI step on re-runs.
 *
 * Usage:
 *   pnpm tsx scripts/bootstrap-core-content.ts --grade 9 --subjects "Economics,Geography,History,Political Science"
 *   pnpm tsx scripts/bootstrap-core-content.ts --grade 10 --subjects "Science,Economics" --language en
 *   pnpm tsx scripts/bootstrap-core-content.ts --grade 11 --subjects Mathematics --max-chapters 3 --dry-run
 */
import { config } from "dotenv";
config({ path: ".env.local", override: true });
config({ path: ".env" });

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { sql } from "drizzle-orm";
import { db } from "../src/db";
import {
  runNcertDownload,
  NCERT_BOOK_CATALOG,
  getCanonicalSubjectSlug,
} from "../src/lib/scraper/ncert-downloader";
import type { NcertDownloadOptions } from "../src/lib/scraper/ncert-downloader";

const TITLE_CACHE_DIR = join(process.cwd(), "data", "ncert-chapter-titles");

function parseArgs(argv: string[]) {
  const val = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const gradesStr = val("--grade") ?? val("--grades") ?? "";
  const subjectsStr = val("--subjects") ?? "";
  const language = (val("--language") as "en" | "hi") ?? "en";
  const maxChapters = Number(val("--max-chapters") ?? "50");
  return {
    grades: gradesStr ? gradesStr.split(",").map((g) => Number(g.trim())).filter(Boolean) : [],
    subjects: subjectsStr ? subjectsStr.split(",").map((s) => s.trim().toLowerCase()) : [],
    language,
    maxChapters,
    dryRun: argv.includes("--dry-run"),
    downloadOnly: argv.includes("--download-only"),
  };
}

function loadCanonicalTitles(grade: number, subjectCode: string): Record<string, string> | null {
  const slug = getCanonicalSubjectSlug(subjectCode);
  const cachePath = join(TITLE_CACHE_DIR, `${grade}-${slug}.json`);
  if (!existsSync(cachePath)) return null;
  try {
    return JSON.parse(readFileSync(cachePath, "utf8")) as Record<string, string>;
  } catch {
    return null;
  }
}

async function renameDefaultTopics(boardCode: string, grade: number, subjectName: string, bookCode: string) {
  // Find all topics under this (board, grade, subject) that still carry the default
  // auto-generated title, and rename them to their chapter's canonical title.
  const titles = loadCanonicalTitles(grade, bookCode);

  const res = await db.execute(sql`
    SELECT t.id AS topic_id, t.title AS topic_title,
           c.chapter_number, c.title AS chapter_title
    FROM topics t
    JOIN chapters c ON c.id = t.chapter_id
    JOIN subjects s ON s.id = c.subject_id
    JOIN standards st ON st.id = s.standard_id
    JOIN boards b ON b.id = st.board_id
    WHERE b.code = ${boardCode} AND st.grade = ${grade}
      AND LOWER(s.name) = LOWER(${subjectName})
      AND t.title ~ '^Chapter [0-9]+ Content$'
    ORDER BY c.chapter_number, t.id
  `);
  const rows = (Array.isArray(res) ? res : (res as { rows?: Array<{ topic_id: string; topic_title: string; chapter_number: number; chapter_title: string }> }).rows ?? []) as Array<{
    topic_id: string;
    topic_title: string;
    chapter_number: number;
    chapter_title: string;
  }>;

  if (rows.length === 0) {
    console.log(`  [rename] no default "Chapter N Content" topics to rename`);
    return;
  }

  let renamed = 0;
  for (const r of rows) {
    const canonical = titles?.[String(r.chapter_number)];
    const newTitle = canonical ?? r.chapter_title ?? r.topic_title;
    // Avoid renaming to "Book — Chapter N" placeholder (that's the default chapter title)
    if (!newTitle || /Chapter \d+/.test(newTitle)) continue;
    if (newTitle === r.topic_title) continue;
    await db.execute(sql`UPDATE topics SET title = ${newTitle} WHERE id = ${Number(r.topic_id)}`);
    console.log(`    ✓ topic ${r.topic_id}: "${r.topic_title}" → "${newTitle}"`);
    renamed++;
  }
  console.log(`  [rename] ${renamed}/${rows.length} topics renamed to canonical titles`);
}

async function processBook(book: typeof NCERT_BOOK_CATALOG[number], opts: ReturnType<typeof parseArgs>) {
  console.log(`\n── ${book.code} | Class ${book.grade} ${book.subject} (${book.language}) | "${book.name}" | ${book.chapters} chapters`);

  if (opts.dryRun) {
    console.log(`  [dry-run] would invoke runNcertDownload({ grades:[${book.grade}], bookCodes:["${book.code}"], languages:["${book.language}"], maxChapters:${Math.min(book.chapters, opts.maxChapters)} })`);
    return { downloaded: 0, parsed: 0 };
  }

  // Use bookCodes (exact-match) instead of subjects (substring-match) so that
  // multi-part subjects like Physics Gr11 (keph1 + keph2) don't both slip
  // through filterCatalog and collide on runNcertDownload's global
  // maxChapters cap. Bootstrap already iterates book-by-book, so we want
  // the filter to return exactly one book per call.
  const downloadOpts: NcertDownloadOptions = {
    grades: [book.grade],
    bookCodes: [book.code],
    languages: [book.language as "en" | "hi"],
    maxChapters: Math.min(book.chapters, opts.maxChapters),
    downloadOnly: opts.downloadOnly,
    resume: true,
  };
  const result = await runNcertDownload(downloadOpts);
  console.log(`  [download] books=${result.booksProcessed} ch=${result.chaptersDownloaded}↓/${result.chaptersParsed}🤖/${result.chaptersSkipped}⤵/${result.chaptersFailed}✗`);
  if (result.errors.length > 0) {
    for (const e of result.errors.slice(0, 5)) console.log(`    ⚠ ${e}`);
    if (result.errors.length > 5) console.log(`    ... ${result.errors.length - 5} more errors`);
  }

  // Post-pass: rename default topics
  await renameDefaultTopics("CBSE", book.grade, book.subject, book.code);

  return { downloaded: result.chaptersDownloaded, parsed: result.chaptersParsed };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.grades.length === 0) {
    console.error("Usage: pnpm tsx scripts/bootstrap-core-content.ts --grade 9 --subjects \"Economics,Geography,History,Political Science\"");
    process.exit(1);
  }

  // Substring match so --subjects "Geography" picks up both "Geography" (Part I)
  // and "Geography (Part II)" catalog entries. Without this, Part II books for
  // Physics/Chemistry/Accountancy/Geography/Sociology/PolSci get silently skipped.
  const subjectFilter = opts.subjects.length > 0
    ? (s: string) => opts.subjects.some((want) => s.toLowerCase().includes(want))
    : () => true;

  const targets = NCERT_BOOK_CATALOG.filter(
    (b) =>
      opts.grades.includes(b.grade) &&
      b.language === opts.language &&
      subjectFilter(b.subject)
  );

  console.log(`\n=== Bootstrap core NCERT content (${opts.dryRun ? "DRY RUN" : "LIVE"}) ===`);
  console.log(`grades=${opts.grades.join(",")} | subjects=${opts.subjects.join(",") || "(all)"} | language=${opts.language} | maxCh=${opts.maxChapters}`);
  console.log(`Matched ${targets.length} NCERT book(s):`);
  for (const t of targets) {
    console.log(`  ${t.code} | Class ${t.grade} ${t.subject} | "${t.name}" | ${t.chapters} chapters`);
  }

  let totalDl = 0, totalParsed = 0;
  for (const book of targets) {
    const r = await processBook(book, opts);
    totalDl += r.downloaded;
    totalParsed += r.parsed;
  }

  console.log(`\n=== Summary ===`);
  console.log(`  books processed: ${targets.length}`);
  console.log(`  chapters downloaded: ${totalDl}`);
  console.log(`  chapters AI-parsed:  ${totalParsed}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
