#!/usr/bin/env tsx
/**
 * Remap topic → NCERT chapter PDF assignments.
 *
 * Problem: the syllabus scraper and NCERT downloader were run out of order,
 * leaving many topics linked to the wrong chapter PDF (e.g. Probability topic
 * pointing at ch01.pdf which is Real Numbers). The AI enrichment then produced
 * refusal bodies like "Probability is not covered in this chapter".
 *
 * This script fixes the mapping and (optionally) clears the bad bodies so
 * the enrichment worker regenerates content from the correct PDF. It is
 * idempotent — safe to run repeatedly, and safe to run on boards/grades
 * that haven't been scraped yet (it just reports "no PDFs found").
 *
 * Usage:
 *   pnpm tsx scripts/remap-topic-pdfs.ts --grade 10 --subject Mathematics
 *   pnpm tsx scripts/remap-topic-pdfs.ts --grade 10 --subject Mathematics --dry-run
 *   pnpm tsx scripts/remap-topic-pdfs.ts --grade 10 --subject Mathematics --re-enrich
 *   pnpm tsx scripts/remap-topic-pdfs.ts --all                  # every NCERT book present on disk
 *
 * Flags:
 *   --dry-run        Report planned changes without writing
 *   --re-enrich      Clear refusal bodies and flag for re-extraction
 *   --all            Iterate over every (grade, subject, language) with PDFs on disk
 *   --board CODE     Board code (default: CBSE)
 *   --language en|hi Defaults to en
 */

import { config } from "dotenv";
config({ path: ".env.local", override: true });
config({ path: ".env" });

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, statSync } from "fs";
import { join } from "path";
import { eq, and, sql } from "drizzle-orm";

import { db } from "../src/db";
import { boards, standards, subjects, chapters, topics } from "../src/db/schema/curriculum";
import { contentItems } from "../src/db/schema/content";
import {
  NCERT_BOOK_CATALOG,
  type NcertBook,
  getCanonicalSubjectSlug,
} from "../src/lib/scraper/ncert-downloader";
import { extractTextFromPdf } from "../src/lib/scraper/parser";

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface Args {
  board: string;
  grade?: number;
  subject?: string;
  language: "en" | "hi";
  all: boolean;
  dryRun: boolean;
  reEnrich: boolean;
}

function parseArgs(argv: string[]): Args {
  const flag = (name: string) => argv.includes(name);
  const value = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const gradeRaw = value("--grade");
  const lang = (value("--language") ?? "en") as "en" | "hi";
  return {
    board: value("--board") ?? "CBSE",
    grade: gradeRaw ? parseInt(gradeRaw, 10) : undefined,
    subject: value("--subject"),
    language: lang === "hi" ? "hi" : "en",
    all: flag("--all"),
    dryRun: flag("--dry-run"),
    reEnrich: flag("--re-enrich"),
  };
}

const log = (msg: string) => console.log(`[Remap] ${msg}`);

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const PDF_ROOT = join(process.cwd(), "data", "ncert-pdfs");
const TITLE_CACHE_DIR = join(process.cwd(), "data", "ncert-chapter-titles");

/**
 * Canonical per-book slug (matches ncert-downloader.ts::getLocalPath). Derives
 * from the immutable NCERT_CODE_INVARIANTS table via getCanonicalSubjectSlug,
 * never from the mutable book.subject label — so accidental catalog edits
 * can't cause this script to read/write the wrong directory.
 */
function subjectSlugForBook(book: NcertBook): string {
  const slug = getCanonicalSubjectSlug(book.code);
  return book.language === "hi" ? `${slug}_hi` : slug;
}

function pdfRelativePath(book: NcertBook, chapterNum: number): string {
  const chapterCode = chapterNum.toString().padStart(2, "0");
  return `data/ncert-pdfs/${book.grade}/${subjectSlugForBook(book)}/ch${chapterCode}.pdf`;
}

// ---------------------------------------------------------------------------
// Chapter-title extraction (with disk cache)
// ---------------------------------------------------------------------------

interface ChapterTitleMap {
  [chapterNum: number]: string;
}

async function loadOrExtractChapterTitles(
  book: NcertBook,
  grade: number,
  language: string
): Promise<ChapterTitleMap> {
  const slug = subjectSlugForBook(book);
  const cachePath = join(TITLE_CACHE_DIR, `${grade}-${slug}.json`);

  if (existsSync(cachePath)) {
    try {
      const raw = JSON.parse(readFileSync(cachePath, "utf8")) as ChapterTitleMap;
      if (raw && typeof raw === "object") return raw;
    } catch { /* fall through to re-extract */ }
  }

  const titles: ChapterTitleMap = {};
  const pdfDir = join(PDF_ROOT, String(grade), slug);
  if (!existsSync(pdfDir)) {
    log(`  No PDF directory: ${pdfDir} — titles map will be empty`);
    return titles;
  }

  for (let ch = 1; ch <= book.chapters; ch++) {
    const chapterCode = ch.toString().padStart(2, "0");
    const pdfPath = join(pdfDir, `ch${chapterCode}.pdf`);
    if (!existsSync(pdfPath)) continue;

    try {
      const buffer = readFileSync(pdfPath);
      const text = await extractTextFromPdf(buffer);
      const title = guessChapterTitle(text, ch);
      if (title) {
        titles[ch] = title;
        log(`  ch${chapterCode}: "${title}"`);
      } else {
        log(`  ch${chapterCode}: (title unreadable)`);
      }
    } catch (err) {
      log(`  ch${chapterCode}: extract failed — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (!existsSync(TITLE_CACHE_DIR)) mkdirSync(TITLE_CACHE_DIR, { recursive: true });
  writeFileSync(cachePath, JSON.stringify(titles, null, 2));
  log(`  Cached titles → ${cachePath}`);
  return titles;
}

/**
 * Pick the most likely chapter heading from the extracted PDF text.
 *
 * NCERT class 6-12 PDFs extract in a predictable shape:
 *   - Odd-numbered chapter (right-hand page): title is ALL-CAPS, sometimes
 *     wrapped across 2–3 lines, with a page-number suffix mashed onto the
 *     last line (e.g. "COORDINATE GEOMETRY99", "TRIGONOMETRY133").
 *   - Even-numbered chapter (left-hand page): first-page header is a running
 *     header like "10MATHEMATICS" — the real title appears later as a
 *     repeated running header on subsequent pages.
 *   - A chapter-number-only line ("7") and a section-1 line ("7.1Introduction"
 *     or "7.1  Introduction") always appear right after the title block.
 *
 * Strategy: find the "{ch}.1" anchor, walk backwards past the chapter-number
 * line, and collect contiguous all-caps title lines (stripping trailing page
 * digits). Fall back to the most frequent all-caps running header when the
 * first page lacked the title (even-chapter case).
 */
function guessChapterTitle(text: string, chapterNum: number): string | null {
  const rawLines = text.split(/\r?\n/).map((l) => l.trim());

  // Anchor: "{ch}.1[Introduction]" or "{ch}.1 Something"
  const anchorRx = new RegExp(`^${chapterNum}\\.1\\b`);
  let anchor = -1;
  for (let i = 0; i < Math.min(rawLines.length, 80); i++) {
    if (anchorRx.test(rawLines[i])) { anchor = i; break; }
  }

  const isChapterNumLine = (s: string) => s === String(chapterNum);
  const looksLikeRunningFooter = (s: string) =>
    /^\d+MATHEMATICS$/i.test(s) || /^MATHEMATICS\d+$/i.test(s) ||
    /^\d+[A-Z]{4,}$/.test(s) || /^Reprint\s+\d/i.test(s) || s === "";

  // Back-up collect ALL-CAPS title lines just above the "{ch}.1" anchor.
  const stripTrailingDigits = (s: string) => s.replace(/\d+$/, "").trim();
  const isTitleLine = (s: string) => {
    if (!s) return false;
    const core = stripTrailingDigits(s);
    if (core.length < 2 || core.length > 60) return false;
    // Allow caps, spaces, and a few punctuation marks
    return /^[A-Z][A-Z \-'’()&,.]*$/.test(core) && /[A-Z]{2,}/.test(core);
  };

  const collectAbove = (anchorIdx: number): string[] => {
    if (anchorIdx < 0) return [];
    const picked: string[] = [];
    let i = anchorIdx - 1;
    // Skip the chapter-number-only line and any blanks / running footers
    while (i >= 0 && (rawLines[i] === "" || isChapterNumLine(rawLines[i]) || looksLikeRunningFooter(rawLines[i]))) i--;
    // Collect contiguous title lines walking upward
    while (i >= 0 && picked.length < 4 && isTitleLine(rawLines[i])) {
      picked.push(stripTrailingDigits(rawLines[i]));
      i--;
    }
    return picked.reverse();
  };

  const fromAnchor = collectAbove(anchor);
  if (fromAnchor.length > 0) {
    return toTitleCase(fromAnchor.join(" ").replace(/\s+/g, " ").trim());
  }

  // Fallback: running-header frequency count.
  // On even-chapter left-pages the first occurrence is "{pageNum}MATHEMATICS",
  // but the same title repeats on later pages as the right-page header.
  const freq = new Map<string, number>();
  for (const line of rawLines) {
    if (!isTitleLine(line)) continue;
    const core = stripTrailingDigits(line);
    // Skip single-letter residue like "N" (from "REAL N\nUMBERS" splits)
    if (core.length < 3) continue;
    freq.set(core, (freq.get(core) ?? 0) + 1);
  }
  const candidates = [...freq.entries()].sort((a, b) => b[1] - a[1]);
  const top = candidates.find(([, c]) => c >= 2) ?? candidates[0];
  if (top) return toTitleCase(top[0]);
  return null;
}

function toTitleCase(s: string): string {
  return s
    .toLowerCase()
    .split(" ")
    .map((w) => (w.length > 2 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ")
    .replace(/\b([a-z])/, (m) => m.toUpperCase());
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  "a", "an", "the", "of", "and", "in", "on", "to", "for", "chapter", "content",
  "notes", "part", "i", "ii", "iii", "iv", "introduction", "class",
]);

function normalize(s: string): string[] {
  return s
    .toLowerCase()
    // Split letter↔digit boundaries so "geometry99" → "geometry 99"
    .replace(/([a-z])(\d)/g, "$1 $2")
    .replace(/(\d)([a-z])/g, "$1 $2")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    // Drop stopwords and pure-numeric tokens (page numbers, chapter numbers)
    .filter((w) => w && !STOPWORDS.has(w) && !/^\d+$/.test(w));
}

function jaccardSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const w of setA) if (setB.has(w)) intersection++;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

interface Match {
  chapterNum: number;
  title: string;
  score: number;
}

/**
 * Find the best NCERT chapter for a given (topic_title, db_chapter_title).
 * Returns null if no candidate clears the threshold.
 */
function findBestMatch(
  topicTitle: string,
  dbChapterTitle: string,
  titles: ChapterTitleMap
): Match | null {
  const topicTokens = normalize(topicTitle);
  const chapterTokens = normalize(dbChapterTitle);

  let best: Match | null = null;
  for (const [chNumStr, ncertTitle] of Object.entries(titles)) {
    const ncertTokens = normalize(ncertTitle);
    const scoreTopic = jaccardSimilarity(topicTokens, ncertTokens);
    const scoreChapter = jaccardSimilarity(chapterTokens, ncertTokens);
    const score = Math.max(scoreTopic, scoreChapter * 0.9); // slight preference for topic match
    if (!best || score > best.score) {
      best = { chapterNum: parseInt(chNumStr, 10), title: ncertTitle, score };
    }
  }

  // Threshold: require meaningful overlap. Exact matches get 1.0.
  if (best && best.score >= 0.55) return best;
  return null;
}

// ---------------------------------------------------------------------------
// Refusal detection — bodies where AI declined because PDF was wrong
// ---------------------------------------------------------------------------

const REFUSAL_PATTERNS = [
  /is not covered in (the|this) (provided |given )?chapter/i,
  /does not (contain|include|cover) (content |information )?(specifically )?about/i,
  /not (present|found|available) in (the|this) (provided|given|chapter)/i,
  /chapter (focuses on|is about) .* (not|instead of)/i,
];

function looksLikeRefusal(body: string | null | undefined): boolean {
  if (!body) return false;
  const firstPara = body.slice(0, 600);
  return REFUSAL_PATTERNS.some((rx) => rx.test(firstPara));
}

// ---------------------------------------------------------------------------
// Main remap flow
// ---------------------------------------------------------------------------

interface RemapStats {
  remapped: number;
  flagged: number;
  cleared: number;
  unchanged: number;
  missingPdf: number;
}

async function remapSubject(
  args: Args,
  book: NcertBook,
  grade: number
): Promise<RemapStats> {
  const stats: RemapStats = { remapped: 0, flagged: 0, cleared: 0, unchanged: 0, missingPdf: 0 };

  log(`\n── ${args.board} Class ${grade} ${book.subject} (${book.language}) [${book.code}] ──`);

  // Resolve board → standard → subject
  const [boardRow] = await db.select({ id: boards.id }).from(boards).where(eq(boards.code, args.board)).limit(1);
  if (!boardRow) { log(`  Board ${args.board} not found in DB`); return stats; }

  const [standard] = await db.select({ id: standards.id }).from(standards)
    .where(and(eq(standards.boardId, boardRow.id), eq(standards.grade, grade)))
    .limit(1);
  if (!standard) { log(`  Standard (grade ${grade}) not found`); return stats; }

  const [subject] = await db.select({ id: subjects.id }).from(subjects)
    .where(and(
      eq(subjects.standardId, standard.id),
      sql`lower(${subjects.name}) = lower(${book.subject})`
    ))
    .limit(1);
  if (!subject) { log(`  Subject ${book.subject} not found under grade ${grade}`); return stats; }

  // Extract NCERT chapter titles
  log(`  Extracting chapter titles from PDFs...`);
  const titles = await loadOrExtractChapterTitles(book, grade, args.language);
  if (Object.keys(titles).length === 0) {
    log(`  No chapter titles available. Download NCERT PDFs first. Skipping.`);
    stats.missingPdf++;
    return stats;
  }

  // Fetch topics + their note-type content items
  const rows = await db.execute<{
    chapter_id: number;
    chapter_number: number;
    chapter_title: string;
    topic_id: number;
    topic_title: string;
    content_id: number | null;
    content_body: string | null;
    content_quality_score: string | null;
    content_metadata: Record<string, unknown> | null;
  }>(sql`
    SELECT ch.id AS chapter_id, ch.chapter_number, ch.title AS chapter_title,
           t.id AS topic_id, t.title AS topic_title,
           ci.id AS content_id, ci.body AS content_body,
           ci.quality_score AS content_quality_score,
           ci.metadata AS content_metadata
    FROM chapters ch
    JOIN topics t ON t.chapter_id = ch.id
    LEFT JOIN content_items ci ON ci.topic_id = t.id AND ci.content_type = 'note'
    WHERE ch.subject_id = ${subject.id}
    ORDER BY ch.chapter_number, t.sort_order
  `);

  for (const row of rows) {
    const match = findBestMatch(row.topic_title, row.chapter_title, titles);

    if (!match) {
      if (row.content_id) {
        const metaPatch = {
          ...(row.content_metadata ?? {}),
          remap: {
            status: "no-ncert-match",
            attemptedAt: new Date().toISOString(),
            db_chapter: row.chapter_title,
          },
        };
        if (!args.dryRun) {
          await db.update(contentItems)
            .set({
              reviewStatus: "needs_review",
              qualityScore: "0.00",
              metadata: metaPatch,
              updatedAt: new Date(),
            })
            .where(eq(contentItems.id, row.content_id));
        }
        stats.flagged++;
        log(`  ⚠ topic ${row.topic_id} "${row.topic_title}" under "${row.chapter_title}" → no NCERT match (flagged)`);
      } else {
        stats.unchanged++;
      }
      continue;
    }

    const pdfPath = pdfRelativePath(book, match.chapterNum);
    if (!existsSync(join(process.cwd(), pdfPath))) {
      stats.missingPdf++;
      log(`  ✗ topic ${row.topic_id} "${row.topic_title}" → ch${match.chapterNum} but PDF missing: ${pdfPath}`);
      continue;
    }

    const sourceUrl = `file://${pdfPath}`;
    const existingMeta = row.content_metadata ?? {};
    const newMetadata = {
      ...existingMeta,
      pdfPath,
      extractedFrom: pdfPath,
      chapterNumber: match.chapterNum,
      chapterTitle: match.title,
      remap: {
        status: "mapped",
        score: Number(match.score.toFixed(3)),
        ncertChapter: match.chapterNum,
        ncertTitle: match.title,
        remappedAt: new Date().toISOString(),
      },
    };

    const wasRefusal = looksLikeRefusal(row.content_body);
    const currentQualityStr = row.content_quality_score ?? "0";
    const currentQuality = parseFloat(currentQualityStr) || 0;
    const isLowQuality = currentQuality < 0.5;

    if (row.content_id) {
      const updates: Record<string, unknown> = {
        sourceUrl,
        metadata: newMetadata,
        updatedAt: new Date(),
      };

      if ((args.reEnrich && (wasRefusal || isLowQuality)) || wasRefusal) {
        // Clear the refusal body so the enrichment worker picks it up again.
        updates.body = "";
        updates.qualityScore = "0.00";
        updates.reviewStatus = "pending";
        updates.isPublished = false;
        stats.cleared++;
      }

      if (!args.dryRun) {
        await db.update(contentItems).set(updates).where(eq(contentItems.id, row.content_id));
      }
      stats.remapped++;
      const note = wasRefusal ? " [cleared refusal]" : isLowQuality && args.reEnrich ? " [cleared low-quality]" : "";
      log(`  ✓ topic ${row.topic_id} "${row.topic_title}" → ch${match.chapterNum} "${match.title}" (score ${match.score.toFixed(2)})${note}`);
    } else {
      // No content item exists yet — record the mapping on the topic itself so
      // future enrichment uses the correct PDF. (Cheap pointer, not content.)
      if (!args.dryRun) {
        await db.update(topics)
          .set({
            metadata: sql`coalesce(${topics.metadata}, '{}'::jsonb) || ${JSON.stringify({
              pdfPath,
              sourceUrl,
              ncertChapter: match.chapterNum,
              ncertTitle: match.title,
              remappedAt: new Date().toISOString(),
            })}::jsonb`,
          })
          .where(eq(topics.id, row.topic_id));
      }
      stats.remapped++;
      log(`  + topic ${row.topic_id} "${row.topic_title}" → ch${match.chapterNum} (no content yet; saved pointer)`);
    }
  }

  return stats;
}

// ---------------------------------------------------------------------------
// --all mode: discover every (grade, subject, language) with PDFs on disk
// ---------------------------------------------------------------------------

function discoverAvailableBooks(): NcertBook[] {
  if (!existsSync(PDF_ROOT)) return [];
  const found: NcertBook[] = [];
  for (const gradeDir of readdirSync(PDF_ROOT)) {
    const gradePath = join(PDF_ROOT, gradeDir);
    if (!statSync(gradePath).isDirectory()) continue;
    const grade = parseInt(gradeDir, 10);
    if (!Number.isFinite(grade)) continue;

    for (const subjDir of readdirSync(gradePath)) {
      const subjPath = join(gradePath, subjDir);
      if (!statSync(subjPath).isDirectory()) continue;

      const language: "en" | "hi" = subjDir.endsWith("_hi") ? "hi" : "en";
      const book = NCERT_BOOK_CATALOG.find((b) =>
        b.grade === grade &&
        b.language === language &&
        subjectSlugForBook(b) === subjDir
      );
      if (book) found.push(book);
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));

  log("=".repeat(60));
  log(`Remap topic → PDF  (board=${args.board} dryRun=${args.dryRun} reEnrich=${args.reEnrich})`);
  log("=".repeat(60));

  const targets: Array<{ book: NcertBook; grade: number }> = [];

  if (args.all) {
    for (const book of discoverAvailableBooks()) targets.push({ book, grade: book.grade });
    if (targets.length === 0) {
      log("No NCERT PDFs found under data/ncert-pdfs/. Nothing to do.");
      process.exit(0);
    }
  } else {
    if (!args.grade || !args.subject) {
      log("Usage: --grade N --subject NAME [--language en|hi] [--dry-run] [--re-enrich]");
      log("   or: --all");
      process.exit(1);
    }
    const book = NCERT_BOOK_CATALOG.find((b) =>
      b.grade === args.grade &&
      b.language === args.language &&
      b.subject.toLowerCase() === args.subject!.toLowerCase()
    );
    if (!book) {
      log(`No NCERT book in catalog for grade=${args.grade} subject=${args.subject} language=${args.language}`);
      process.exit(1);
    }
    targets.push({ book, grade: args.grade });
  }

  const totals: RemapStats = { remapped: 0, flagged: 0, cleared: 0, unchanged: 0, missingPdf: 0 };
  for (const { book, grade } of targets) {
    const s = await remapSubject(args, book, grade);
    totals.remapped += s.remapped;
    totals.flagged += s.flagged;
    totals.cleared += s.cleared;
    totals.unchanged += s.unchanged;
    totals.missingPdf += s.missingPdf;
  }

  log("");
  log("=".repeat(60));
  log("REMAP COMPLETE");
  log("=".repeat(60));
  log(`Remapped: ${totals.remapped}`);
  log(`Flagged (no match): ${totals.flagged}`);
  log(`Refusal bodies cleared: ${totals.cleared}`);
  log(`Unchanged: ${totals.unchanged}`);
  log(`Missing PDFs: ${totals.missingPdf}`);
  if (args.dryRun) log(`(dry run — no DB changes written)`);
  if (totals.cleared > 0 && !args.dryRun) {
    log("");
    log(`Next step: re-run enrichment to regenerate cleared bodies, e.g.`);
    log(`   pnpm tsx scripts/enrich-existing-content.ts`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
