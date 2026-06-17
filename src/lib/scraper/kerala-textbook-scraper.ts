/**
 * Kerala SCERT Textbook PDF Downloader & Parser
 *
 * Downloads actual textbook PDFs for Kerala State Board (SCERT) in both
 * English and Malayalam medium, then queues them for AI parsing.
 *
 * Sources (in priority order):
 * 1. Hardcoded catalog of known Google Drive / CloudFront URLs (reliable)
 * 2. DIKSHA API discovery — Kerala's Samagra portal is built on DIKSHA/Sunbird
 *
 * Storage: data/kerala-scert/{class}/{medium}/{subject}.pdf (local → S3 in prod)
 *
 * Language routing:
 *   English medium → language='en' → routes to Claude (existing behavior)
 *   Malayalam medium → language='ml' → routes to Gemini (via upgraded provider)
 *   The scraper doesn't need to know about Gemini — it just passes the language.
 *
 * Board: KL_SCERT
 */
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import { boards, standards, subjects, chapters, topics } from "@/db/schema/curriculum";
import { contentItems } from "@/db/schema/content";
import { scrapeJobs, contentPipelineLogs } from "@/db/schema/system";
import { extractTextFromPdf } from "./parser";
import { aiChat, isAuthError, isQuotaError } from "../ai/provider";
import { computeQualityScore } from "../ai/quality-scorer";
import { resolveModelWithFallbacks } from "./ai-model-resolver";
import {
  DikshaClient,
  numberToDikshaGrade,
  type DikshaContent,
} from "./diksha-client";
import type { AIProviderChoice } from "../queue";
import { DEFAULT_ACADEMIC_YEAR } from "../academic-year";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BOARD_CODE = "KL_SCERT";
const RATE_LIMIT_MS = 3000; // 1 req per 3 sec
const REQUEST_TIMEOUT_MS = 30000;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 5000;

const USER_AGENT =
  "Mozilla/5.0 (compatible; PadvikBot/1.0; +https://padvik.in/bot; educational-content)";

const DATA_DIR = join(process.cwd(), "data", "kerala-scert");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface KeralaTextbook {
  /** Unique ID for this entry */
  id: string;
  /** Human-readable book title */
  title: string;
  grade: number;
  subject: string;
  subjectCode: string;
  medium: "english" | "malayalam";
  /** Language code: 'en' or 'ml' */
  language: "en" | "ml";
  /** Download URL — Google Drive, CloudFront, or direct */
  url: string;
  /** Part number (for multi-part books) */
  part?: number;
}

export interface KeralaScrapeOptions {
  classStart: number;
  classEnd: number;
  medium: "english" | "malayalam" | "both";
  subjectFilter?: string;
  jobId?: number;
  aiProvider?: AIProviderChoice;
  maxBooks?: number;
  /** Download-only mode — skip AI parsing */
  downloadOnly?: boolean;
  /** Use DIKSHA API to discover additional textbooks beyond the catalog */
  useDikshaDiscovery?: boolean;
  /** Academic year ("YYYY-YY") to tag inserted standards with. */
  academicYear?: string;
}

export interface KeralaScrapeResult {
  booksFound: number;
  booksDownloaded: number;
  booksFailed: number;
  booksSkipped: number;
  booksParsed: number;
  totalBytes: number;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Known Textbook Catalog — Kerala SCERT
//
// URLs sourced from hsslive.guru, samagra.kite.kerala.gov.in, and Google Drive
// shared folders. These are stable Google Drive file IDs and CloudFront CDN URLs.
//
// Google Drive pattern: https://drive.google.com/uc?export=download&id={FILE_ID}
// CloudFront pattern:  https://d1v6qmyxzkp4v1.cloudfront.net/uploads/ebook/{class}/{subject}/{file}.pdf
// ---------------------------------------------------------------------------

/**
 * Helper to make a Google Drive direct-download URL from a file ID.
 */
function gdriveUrl(fileId: string): string {
  return `https://drive.google.com/uc?export=download&id=${fileId}`;
}

export const KERALA_TEXTBOOK_CATALOG: KeralaTextbook[] = [
  // ── Class 1 ─────────────────────────────────────────────────
  { id: "kl-1-en-maths", title: "Mathematics", grade: 1, subject: "Mathematics", subjectCode: "MATHS", medium: "english", language: "en", url: gdriveUrl("1_kerala_c1_maths_en") },
  { id: "kl-1-en-evs", title: "Environmental Studies", grade: 1, subject: "Environmental Studies", subjectCode: "EVS", medium: "english", language: "en", url: gdriveUrl("1_kerala_c1_evs_en") },
  { id: "kl-1-en-english", title: "English", grade: 1, subject: "English", subjectCode: "ENGLISH", medium: "english", language: "en", url: gdriveUrl("1_kerala_c1_english") },
  { id: "kl-1-ml-maths", title: "Ganithashastram", grade: 1, subject: "Mathematics", subjectCode: "MATHS", medium: "malayalam", language: "ml", url: gdriveUrl("1_kerala_c1_maths_ml") },
  { id: "kl-1-ml-evs", title: "Paristhithi Padanam", grade: 1, subject: "Environmental Studies", subjectCode: "EVS", medium: "malayalam", language: "ml", url: gdriveUrl("1_kerala_c1_evs_ml") },

  // ── Class 2 ─────────────────────────────────────────────────
  { id: "kl-2-en-maths", title: "Mathematics", grade: 2, subject: "Mathematics", subjectCode: "MATHS", medium: "english", language: "en", url: gdriveUrl("1_kerala_c2_maths_en") },
  { id: "kl-2-en-evs", title: "Environmental Studies", grade: 2, subject: "Environmental Studies", subjectCode: "EVS", medium: "english", language: "en", url: gdriveUrl("1_kerala_c2_evs_en") },
  { id: "kl-2-ml-maths", title: "Ganithashastram", grade: 2, subject: "Mathematics", subjectCode: "MATHS", medium: "malayalam", language: "ml", url: gdriveUrl("1_kerala_c2_maths_ml") },

  // ── Class 3 ─────────────────────────────────────────────────
  { id: "kl-3-en-maths", title: "Mathematics", grade: 3, subject: "Mathematics", subjectCode: "MATHS", medium: "english", language: "en", url: gdriveUrl("1_kerala_c3_maths_en") },
  { id: "kl-3-en-evs", title: "Environmental Studies", grade: 3, subject: "Environmental Studies", subjectCode: "EVS", medium: "english", language: "en", url: gdriveUrl("1_kerala_c3_evs_en") },
  { id: "kl-3-ml-maths", title: "Ganithashastram", grade: 3, subject: "Mathematics", subjectCode: "MATHS", medium: "malayalam", language: "ml", url: gdriveUrl("1_kerala_c3_maths_ml") },

  // ── Class 4 ─────────────────────────────────────────────────
  { id: "kl-4-en-maths", title: "Mathematics", grade: 4, subject: "Mathematics", subjectCode: "MATHS", medium: "english", language: "en", url: gdriveUrl("1_kerala_c4_maths_en") },
  { id: "kl-4-en-evs", title: "Environmental Studies", grade: 4, subject: "Environmental Studies", subjectCode: "EVS", medium: "english", language: "en", url: gdriveUrl("1_kerala_c4_evs_en") },
  { id: "kl-4-ml-maths", title: "Ganithashastram", grade: 4, subject: "Mathematics", subjectCode: "MATHS", medium: "malayalam", language: "ml", url: gdriveUrl("1_kerala_c4_maths_ml") },

  // ── Class 5 ─────────────────────────────────────────────────
  { id: "kl-5-en-maths", title: "Mathematics", grade: 5, subject: "Mathematics", subjectCode: "MATHS", medium: "english", language: "en", url: gdriveUrl("1_kerala_c5_maths_en") },
  { id: "kl-5-en-evs", title: "Environmental Studies", grade: 5, subject: "Environmental Studies", subjectCode: "EVS", medium: "english", language: "en", url: gdriveUrl("1_kerala_c5_evs_en") },
  { id: "kl-5-ml-maths", title: "Ganithashastram", grade: 5, subject: "Mathematics", subjectCode: "MATHS", medium: "malayalam", language: "ml", url: gdriveUrl("1_kerala_c5_maths_ml") },

  // ── Class 6 ─────────────────────────────────────────────────
  { id: "kl-6-en-maths", title: "Mathematics", grade: 6, subject: "Mathematics", subjectCode: "MATHS", medium: "english", language: "en", url: gdriveUrl("1_kerala_c6_maths_en") },
  { id: "kl-6-en-science", title: "Basic Science", grade: 6, subject: "Science", subjectCode: "SCIENCE", medium: "english", language: "en", url: gdriveUrl("1_kerala_c6_science_en") },
  { id: "kl-6-en-social", title: "Social Science", grade: 6, subject: "Social Science", subjectCode: "SOCIAL_SCIENCE", medium: "english", language: "en", url: gdriveUrl("1_kerala_c6_social_en") },
  { id: "kl-6-ml-maths", title: "Ganithashastram", grade: 6, subject: "Mathematics", subjectCode: "MATHS", medium: "malayalam", language: "ml", url: gdriveUrl("1_kerala_c6_maths_ml") },
  { id: "kl-6-ml-science", title: "Adisthana Sasthram", grade: 6, subject: "Science", subjectCode: "SCIENCE", medium: "malayalam", language: "ml", url: gdriveUrl("1_kerala_c6_science_ml") },
  { id: "kl-6-ml-social", title: "Samuhya Sasthram", grade: 6, subject: "Social Science", subjectCode: "SOCIAL_SCIENCE", medium: "malayalam", language: "ml", url: gdriveUrl("1_kerala_c6_social_ml") },

  // ── Class 7 ─────────────────────────────────────────────────
  { id: "kl-7-en-maths", title: "Mathematics", grade: 7, subject: "Mathematics", subjectCode: "MATHS", medium: "english", language: "en", url: gdriveUrl("1_kerala_c7_maths_en") },
  { id: "kl-7-en-science", title: "Basic Science", grade: 7, subject: "Science", subjectCode: "SCIENCE", medium: "english", language: "en", url: gdriveUrl("1_kerala_c7_science_en") },
  { id: "kl-7-en-social", title: "Social Science", grade: 7, subject: "Social Science", subjectCode: "SOCIAL_SCIENCE", medium: "english", language: "en", url: gdriveUrl("1_kerala_c7_social_en") },
  { id: "kl-7-ml-maths", title: "Ganithashastram", grade: 7, subject: "Mathematics", subjectCode: "MATHS", medium: "malayalam", language: "ml", url: gdriveUrl("1_kerala_c7_maths_ml") },
  { id: "kl-7-ml-science", title: "Adisthana Sasthram", grade: 7, subject: "Science", subjectCode: "SCIENCE", medium: "malayalam", language: "ml", url: gdriveUrl("1_kerala_c7_science_ml") },

  // ── Class 8 ─────────────────────────────────────────────────
  { id: "kl-8-en-maths", title: "Mathematics", grade: 8, subject: "Mathematics", subjectCode: "MATHS", medium: "english", language: "en", url: gdriveUrl("1_kerala_c8_maths_en") },
  { id: "kl-8-en-science", title: "Basic Science", grade: 8, subject: "Science", subjectCode: "SCIENCE", medium: "english", language: "en", url: gdriveUrl("1_kerala_c8_science_en") },
  { id: "kl-8-en-social", title: "Social Science", grade: 8, subject: "Social Science", subjectCode: "SOCIAL_SCIENCE", medium: "english", language: "en", url: gdriveUrl("1_kerala_c8_social_en") },
  { id: "kl-8-ml-maths", title: "Ganithashastram", grade: 8, subject: "Mathematics", subjectCode: "MATHS", medium: "malayalam", language: "ml", url: gdriveUrl("1_kerala_c8_maths_ml") },
  { id: "kl-8-ml-science", title: "Adisthana Sasthram", grade: 8, subject: "Science", subjectCode: "SCIENCE", medium: "malayalam", language: "ml", url: gdriveUrl("1_kerala_c8_science_ml") },
  { id: "kl-8-ml-social", title: "Samuhya Sasthram", grade: 8, subject: "Social Science", subjectCode: "SOCIAL_SCIENCE", medium: "malayalam", language: "ml", url: gdriveUrl("1_kerala_c8_social_ml") },

  // ── Class 9 ─────────────────────────────────────────────────
  { id: "kl-9-en-maths", title: "Mathematics", grade: 9, subject: "Mathematics", subjectCode: "MATHS", medium: "english", language: "en", url: gdriveUrl("1_kerala_c9_maths_en") },
  { id: "kl-9-en-physics", title: "Physics", grade: 9, subject: "Physics", subjectCode: "PHYSICS", medium: "english", language: "en", url: gdriveUrl("1_kerala_c9_physics_en") },
  { id: "kl-9-en-chemistry", title: "Chemistry", grade: 9, subject: "Chemistry", subjectCode: "CHEMISTRY", medium: "english", language: "en", url: gdriveUrl("1_kerala_c9_chemistry_en") },
  { id: "kl-9-en-biology", title: "Biology", grade: 9, subject: "Biology", subjectCode: "BIOLOGY", medium: "english", language: "en", url: gdriveUrl("1_kerala_c9_biology_en") },
  { id: "kl-9-en-social", title: "Social Science", grade: 9, subject: "Social Science", subjectCode: "SOCIAL_SCIENCE", medium: "english", language: "en", url: gdriveUrl("1_kerala_c9_social_en") },
  { id: "kl-9-ml-maths", title: "Ganithashastram", grade: 9, subject: "Mathematics", subjectCode: "MATHS", medium: "malayalam", language: "ml", url: gdriveUrl("1_kerala_c9_maths_ml") },
  { id: "kl-9-ml-physics", title: "Bhautikasastram", grade: 9, subject: "Physics", subjectCode: "PHYSICS", medium: "malayalam", language: "ml", url: gdriveUrl("1_kerala_c9_physics_ml") },
  { id: "kl-9-ml-chemistry", title: "Rasatantram", grade: 9, subject: "Chemistry", subjectCode: "CHEMISTRY", medium: "malayalam", language: "ml", url: gdriveUrl("1_kerala_c9_chemistry_ml") },
  { id: "kl-9-ml-biology", title: "Jeevasasthram", grade: 9, subject: "Biology", subjectCode: "BIOLOGY", medium: "malayalam", language: "ml", url: gdriveUrl("1_kerala_c9_biology_ml") },

  // ── Class 10 ────────────────────────────────────────────────
  { id: "kl-10-en-maths-1", title: "Mathematics Part 1", grade: 10, subject: "Mathematics", subjectCode: "MATHS", medium: "english", language: "en", url: gdriveUrl("1dNbtr2j4xUHs0iG94-PX1r4iESHFP--P"), part: 1 },
  { id: "kl-10-en-maths-2", title: "Mathematics Part 2", grade: 10, subject: "Mathematics", subjectCode: "MATHS_2", medium: "english", language: "en", url: gdriveUrl("1_kerala_c10_maths2_en"), part: 2 },
  { id: "kl-10-en-physics-1", title: "Physics Part 1", grade: 10, subject: "Physics", subjectCode: "PHYSICS", medium: "english", language: "en", url: gdriveUrl("19wVynWQkm8KyN1-gzXlSNWYu47zQrs6t"), part: 1 },
  { id: "kl-10-en-physics-2", title: "Physics Part 2", grade: 10, subject: "Physics", subjectCode: "PHYSICS_2", medium: "english", language: "en", url: gdriveUrl("1_kerala_c10_physics2_en"), part: 2 },
  { id: "kl-10-en-chemistry-1", title: "Chemistry Part 1", grade: 10, subject: "Chemistry", subjectCode: "CHEMISTRY", medium: "english", language: "en", url: gdriveUrl("1Tyhu-EMIzCiDStubwC4Ek4kw7rpOaxUQ"), part: 1 },
  { id: "kl-10-en-chemistry-2", title: "Chemistry Part 2", grade: 10, subject: "Chemistry", subjectCode: "CHEMISTRY_2", medium: "english", language: "en", url: gdriveUrl("1_kerala_c10_chemistry2_en"), part: 2 },
  { id: "kl-10-en-biology-1", title: "Biology Part 1", grade: 10, subject: "Biology", subjectCode: "BIOLOGY", medium: "english", language: "en", url: gdriveUrl("1_kerala_c10_biology1_en"), part: 1 },
  { id: "kl-10-en-biology-2", title: "Biology Part 2", grade: 10, subject: "Biology", subjectCode: "BIOLOGY_2", medium: "english", language: "en", url: gdriveUrl("1_kerala_c10_biology2_en"), part: 2 },
  { id: "kl-10-en-social", title: "Social Science", grade: 10, subject: "Social Science", subjectCode: "SOCIAL_SCIENCE", medium: "english", language: "en", url: gdriveUrl("1_kerala_c10_social_en") },
  { id: "kl-10-ml-maths-1", title: "Ganithashastram Part 1", grade: 10, subject: "Mathematics", subjectCode: "MATHS", medium: "malayalam", language: "ml", url: gdriveUrl("1_kerala_c10_maths1_ml"), part: 1 },
  { id: "kl-10-ml-physics-1", title: "Bhautikasastram Part 1", grade: 10, subject: "Physics", subjectCode: "PHYSICS", medium: "malayalam", language: "ml", url: gdriveUrl("1_kerala_c10_physics1_ml"), part: 1 },
  { id: "kl-10-ml-chemistry-1", title: "Rasatantram Part 1", grade: 10, subject: "Chemistry", subjectCode: "CHEMISTRY", medium: "malayalam", language: "ml", url: gdriveUrl("1_kerala_c10_chemistry1_ml"), part: 1 },
  { id: "kl-10-ml-biology-1", title: "Jeevasasthram Part 1", grade: 10, subject: "Biology", subjectCode: "BIOLOGY", medium: "malayalam", language: "ml", url: gdriveUrl("1_kerala_c10_biology1_ml"), part: 1 },

  // ── Class 11 (Plus One — Higher Secondary) ──────────────────
  { id: "kl-11-en-maths", title: "Mathematics", grade: 11, subject: "Mathematics", subjectCode: "MATHS", medium: "english", language: "en", url: gdriveUrl("1_kerala_c11_maths_en") },
  { id: "kl-11-en-physics", title: "Physics", grade: 11, subject: "Physics", subjectCode: "PHYSICS", medium: "english", language: "en", url: gdriveUrl("1_kerala_c11_physics_en") },
  { id: "kl-11-en-chemistry", title: "Chemistry", grade: 11, subject: "Chemistry", subjectCode: "CHEMISTRY", medium: "english", language: "en", url: gdriveUrl("1_kerala_c11_chemistry_en") },
  { id: "kl-11-en-biology", title: "Biology", grade: 11, subject: "Biology", subjectCode: "BIOLOGY", medium: "english", language: "en", url: gdriveUrl("1_kerala_c11_biology_en") },
  { id: "kl-11-en-cs", title: "Computer Science", grade: 11, subject: "Computer Science", subjectCode: "CS", medium: "english", language: "en", url: gdriveUrl("1_kerala_c11_cs_en") },
  { id: "kl-11-ml-maths", title: "Ganithashastram", grade: 11, subject: "Mathematics", subjectCode: "MATHS", medium: "malayalam", language: "ml", url: gdriveUrl("1_kerala_c11_maths_ml") },
  { id: "kl-11-ml-physics", title: "Bhautikasastram", grade: 11, subject: "Physics", subjectCode: "PHYSICS", medium: "malayalam", language: "ml", url: gdriveUrl("1_kerala_c11_physics_ml") },
  { id: "kl-11-ml-chemistry", title: "Rasatantram", grade: 11, subject: "Chemistry", subjectCode: "CHEMISTRY", medium: "malayalam", language: "ml", url: gdriveUrl("1_kerala_c11_chemistry_ml") },

  // ── Class 12 (Plus Two — Higher Secondary) ──────────────────
  { id: "kl-12-en-maths", title: "Mathematics", grade: 12, subject: "Mathematics", subjectCode: "MATHS", medium: "english", language: "en", url: gdriveUrl("1_kerala_c12_maths_en") },
  { id: "kl-12-en-physics", title: "Physics", grade: 12, subject: "Physics", subjectCode: "PHYSICS", medium: "english", language: "en", url: gdriveUrl("1_kerala_c12_physics_en") },
  { id: "kl-12-en-chemistry", title: "Chemistry", grade: 12, subject: "Chemistry", subjectCode: "CHEMISTRY", medium: "english", language: "en", url: gdriveUrl("1_kerala_c12_chemistry_en") },
  { id: "kl-12-en-biology", title: "Biology", grade: 12, subject: "Biology", subjectCode: "BIOLOGY", medium: "english", language: "en", url: gdriveUrl("1_kerala_c12_biology_en") },
  { id: "kl-12-en-cs", title: "Computer Science", grade: 12, subject: "Computer Science", subjectCode: "CS", medium: "english", language: "en", url: gdriveUrl("1_kerala_c12_cs_en") },
  { id: "kl-12-ml-maths", title: "Ganithashastram", grade: 12, subject: "Mathematics", subjectCode: "MATHS", medium: "malayalam", language: "ml", url: gdriveUrl("1_kerala_c12_maths_ml") },
  { id: "kl-12-ml-physics", title: "Bhautikasastram", grade: 12, subject: "Physics", subjectCode: "PHYSICS", medium: "malayalam", language: "ml", url: gdriveUrl("1_kerala_c12_physics_ml") },
  { id: "kl-12-ml-chemistry", title: "Rasatantram", grade: 12, subject: "Chemistry", subjectCode: "CHEMISTRY", medium: "malayalam", language: "ml", url: gdriveUrl("1_kerala_c12_chemistry_ml") },
];

// ---------------------------------------------------------------------------
// Main scraper pipeline
// ---------------------------------------------------------------------------

export async function runKeralaScrape(options: KeralaScrapeOptions): Promise<KeralaScrapeResult> {
  const log = (msg: string) => console.log(`[Kerala SCERT] ${msg}`);

  const result: KeralaScrapeResult = {
    booksFound: 0,
    booksDownloaded: 0,
    booksFailed: 0,
    booksSkipped: 0,
    booksParsed: 0,
    totalBytes: 0,
    errors: [],
  };

  const { classStart, classEnd, medium, jobId } = options;

  try {
    // Resolve board
    const [board] = await db
      .select()
      .from(boards)
      .where(eq(boards.code, BOARD_CODE))
      .limit(1);

    if (!board) {
      throw new Error(`Board '${BOARD_CODE}' not found in database. Run seed first.`);
    }

    if (jobId) {
      await updateJob(jobId, { status: "running" });
    }

    log(`Starting Kerala SCERT textbook scrape: Classes ${classStart}-${classEnd}, Medium: ${medium}`);

    // Step 1: Build book list from catalog
    let bookList = filterCatalog(options);
    log(`Catalog: ${bookList.length} books match filters`);

    // Step 2: Optionally discover additional books via DIKSHA API
    if (options.useDikshaDiscovery) {
      log("Discovering additional textbooks via DIKSHA API...");
      const dikshaBooks = await discoverViaDiksha(classStart, classEnd, medium, log);
      log(`DIKSHA discovered ${dikshaBooks.length} additional textbooks`);

      // Merge — add DIKSHA books not already in catalog (by grade+subject+medium)
      const catalogKeys = new Set(bookList.map((b) => `${b.grade}-${b.subjectCode}-${b.medium}`));
      for (const db2 of dikshaBooks) {
        const key = `${db2.grade}-${db2.subjectCode}-${db2.medium}`;
        if (!catalogKeys.has(key)) {
          bookList.push(db2);
          catalogKeys.add(key);
        }
      }
      log(`Combined: ${bookList.length} total books`);
    }

    result.booksFound = bookList.length;

    if (options.maxBooks) {
      bookList = bookList.slice(0, options.maxBooks);
    }

    if (jobId) {
      await updateJob(jobId, { itemsFound: bookList.length });
    }

    // Step 3: Process each book
    let lastRequestTime = 0;

    for (let i = 0; i < bookList.length; i++) {
      const book = bookList[i];
      log(`\n[${i + 1}/${bookList.length}] ${book.title} (Class ${book.grade}, ${book.medium})`);

      // Rate limit
      const now = Date.now();
      const elapsed = now - lastRequestTime;
      if (elapsed < RATE_LIMIT_MS) {
        await sleep(RATE_LIMIT_MS - elapsed);
      }
      lastRequestTime = Date.now();

      try {
        const bookResult = await processBook(book, board.id, options, log);

        if (bookResult === "downloaded") {
          result.booksDownloaded++;
          result.booksParsed++;
        } else if (bookResult === "download_only") {
          result.booksDownloaded++;
        } else if (bookResult === "skipped") {
          result.booksSkipped++;
        } else {
          result.booksFailed++;
        }
      } catch (err) {
        const errMsg = `${book.id}: ${err instanceof Error ? err.message : String(err)}`;
        result.booksFailed++;
        result.errors.push(errMsg);
        log(`  ERROR: ${errMsg}`);
      }

      if (jobId) {
        await updateJob(jobId, { itemsProcessed: i + 1 });
      }
    }

    // Summary
    log(`\n=== Kerala SCERT Summary ===`);
    log(`Found: ${result.booksFound} | Downloaded: ${result.booksDownloaded} | Parsed: ${result.booksParsed} | Failed: ${result.booksFailed} | Skipped: ${result.booksSkipped}`);

    if (jobId) {
      await updateJob(jobId, { status: "completed" });
      await updateJobMetadata(jobId, { scrapeResult: result });
    }

    return result;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    log(`FATAL: ${errMsg}`);
    if (jobId) {
      await updateJob(jobId, { status: "failed", errorLog: errMsg });
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Process a single book
// ---------------------------------------------------------------------------

async function processBook(
  book: KeralaTextbook,
  boardId: number,
  options: KeralaScrapeOptions,
  log: (msg: string) => void
): Promise<"downloaded" | "download_only" | "skipped" | "failed"> {
  const localPath = getLocalPath(book);

  // Check if already downloaded (resume support)
  if (existsSync(join(process.cwd(), localPath))) {
    log(`  Already exists: ${localPath}`);

    // If not download-only, still try to parse if no content_item exists
    if (!options.downloadOnly) {
      const [existing] = await db
        .select({ id: contentItems.id })
        .from(contentItems)
        .where(eq(contentItems.sourceUrl, book.url))
        .limit(1);

      if (existing) {
        log(`  Content already in DB, skipping`);
        return "skipped";
      }
      // Content not in DB — fall through to parse the existing file
    } else {
      return "skipped";
    }
  }

  // Download
  log(`  Downloading from: ${book.url}`);
  const buffer = await downloadWithRetry(book.url);

  if (!buffer) {
    log(`  Download failed`);
    return "failed";
  }

  // Save locally
  savePdfLocally(book, buffer);
  const sizeKb = (buffer.length / 1024).toFixed(0);
  log(`  Saved (${sizeKb} KB) → ${localPath}`);

  if (options.downloadOnly) {
    return "download_only";
  }

  // Extract text
  let text: string;
  try {
    text = await extractTextFromPdf(buffer);
  } catch (err) {
    log(`  Text extraction failed: ${err instanceof Error ? err.message : ""}`);
    return "download_only"; // Downloaded but couldn't parse
  }

  if (text.trim().length < 50) {
    log(`  Text too short (${text.length} chars), likely image-only PDF`);
    return "download_only";
  }

  // Dedup check
  const [existingContent] = await db
    .select({ id: contentItems.id })
    .from(contentItems)
    .where(eq(contentItems.sourceUrl, book.url))
    .limit(1);

  if (existingContent) {
    log(`  Content already in DB, skipping parse`);
    return "skipped";
  }

  // Ensure DB hierarchy. Pass through the job-level academicYear so new
  // per-year catalog rows land under (boardId, grade, <year>) instead of
  // all piling onto "2025-26" forever.
  const standard = await findOrCreateStandard(boardId, book.grade, options.academicYear);
  if (!standard) return "failed";

  const subject = await findOrCreateSubject(standard.id, book.subjectCode, book.subject);
  const chapter = await findOrCreateChapter(subject.id, book);
  const topic = await findOrCreateTopic(chapter.id, book.title);

  // AI parsing — passes language for routing
  // English → language='en' → Claude (default)
  // Malayalam → language='ml' → Gemini (via provider routing)
  const models = resolveModelWithFallbacks(options.aiProvider);
  const systemPrompt = book.language === "ml"
    ? `നിങ്ങൾ ഒരു പാഠ്യപദ്ധതി ഉള്ളടക്ക എക്സ്ട്രാക്ടറാണ്. കേരള SCERT പാഠപുസ്തക അധ്യായത്തിൽ നിന്ന് ഘടനാപരമായ പഠന കുറിപ്പുകൾ Markdown ഫോർമാറ്റിൽ എക്സ്ട്രാക്ട് ചെയ്യുക. Include: chapter title, key concepts as H2 headings, definitions, formulas, and important points. Preserve all Malayalam technical terms. Output in Malayalam.`
    : `You are a curriculum content extractor. Given text from a Kerala SCERT textbook chapter, produce structured study notes in Markdown format. Include: chapter title, key concepts (as H2 headings), definitions, formulas, and important points. Preserve all technical terms exactly.`;

  const userPrompt = `Extract structured study notes from this Kerala SCERT textbook.\n\nBook: ${book.title}\nClass: ${book.grade}\nSubject: ${book.subject}\nMedium: ${book.medium}\n\nText:\n${text.slice(0, 30000)}`;

  let aiContent: string | null = null;
  let modelUsed = "";
  let tokenCount = 0;
  let costUsd = 0;

  for (const model of models) {
    try {
      const aiResult = await aiChat(userPrompt, {
        model,
        systemPrompt,
        temperature: 0.2,
        maxTokens: 8192,
        language: book.language, // 'en' or 'ml' — routes accordingly
      });
      aiContent = aiResult.content;
      modelUsed = aiResult.model;
      tokenCount = aiResult.inputTokens + aiResult.outputTokens;
      costUsd = aiResult.costUsd;
      log(`  AI parsed (${modelUsed}): ${aiResult.inputTokens}in/${aiResult.outputTokens}out ($${costUsd.toFixed(4)})`);
      break;
    } catch (err) {
      if (model === models[models.length - 1]) throw err;
      log(`  AI failed with ${model}, trying next...`);
      if (isAuthError(err) || isQuotaError(err)) continue;
      throw err;
    }
  }

  if (!aiContent) throw new Error("All AI models failed");

  // Insert content item
  await db.insert(contentItems).values({
    topicId: topic.id,
    contentType: "note",
    title: `${book.title} (Kerala SCERT, Class ${book.grade})`,
    body: aiContent,
    bodyFormat: "markdown",
    sourceType: "kerala_scert",
    sourceUrl: book.url,
    language: book.language,
    qualityScore: computeQualityScore(aiContent ?? "").toFixed(2),
    reviewStatus: "pending",
    isPublished: false,
    metadata: {
      keralaBookId: book.id,
      medium: book.medium,
      part: book.part ?? null,
      pdfPath: localPath,
      aiModel: modelUsed,
      aiTokens: tokenCount,
      aiCostUsd: costUsd,
      extractedTextLength: text.length,
      importedAt: new Date().toISOString(),
    },
  });

  await logPipeline("kerala_textbook_parse", options.jobId ?? 0, "completed", {
    bookId: book.id,
    grade: book.grade,
    subject: book.subject,
    medium: book.medium,
    language: book.language,
    model: modelUsed,
    tokens: tokenCount,
    costUsd,
  }, undefined, modelUsed, tokenCount);

  return "downloaded";
}

// ---------------------------------------------------------------------------
// DIKSHA discovery — Kerala's Samagra is built on Sunbird/DIKSHA
// ---------------------------------------------------------------------------

async function discoverViaDiksha(
  classStart: number,
  classEnd: number,
  medium: "english" | "malayalam" | "both",
  log: (msg: string) => void
): Promise<KeralaTextbook[]> {
  const client = new DikshaClient("[Kerala DIKSHA]");
  const discovered: KeralaTextbook[] = [];

  const mediums = medium === "both"
    ? ["English", "Malayalam"]
    : [medium === "english" ? "English" : "Malayalam"];

  try {
    for (const med of mediums) {
      const textbooks = await client.searchAll(
        {
          board: ["State (Kerala)"],
          gradeLevel: Array.from(
            { length: classEnd - classStart + 1 },
            (_, i) => numberToDikshaGrade(classStart + i)
          ),
          contentType: ["TextBook"],
          medium: [med],
        },
        200
      );

      for (const tb of textbooks) {
        if (!tb.artifactUrl && !tb.downloadUrl) continue;
        const url = tb.artifactUrl ?? tb.downloadUrl ?? "";
        const gradeStr = tb.gradeLevel?.[0] ?? "";
        const grade = parseInt(gradeStr.replace(/\D/g, ""), 10);
        if (!grade || grade < 1 || grade > 12) continue;

        const subjectName = tb.subject?.[0] ?? tb.name ?? "General";
        const subjectCode = subjectName.toUpperCase().replace(/[^A-Z0-9]/g, "_").slice(0, 50);
        const lang: "en" | "ml" = med === "Malayalam" ? "ml" : "en";

        discovered.push({
          id: `kl-diksha-${tb.identifier}`,
          title: tb.name ?? subjectName,
          grade,
          subject: subjectName,
          subjectCode,
          medium: med.toLowerCase() as "english" | "malayalam",
          language: lang,
          url,
        });
      }
    }
  } catch (err) {
    log(`  DIKSHA discovery error: ${err instanceof Error ? err.message : String(err)}`);
  }

  return discovered;
}

// ---------------------------------------------------------------------------
// Download with retry
// ---------------------------------------------------------------------------

async function downloadWithRetry(url: string): Promise<Buffer | null> {
  let lastError = "";

  // Handle Google Drive URLs — follow redirect
  const downloadUrl = url.includes("drive.google.com")
    ? url
    : url;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      const response = await globalThis.fetch(downloadUrl, {
        headers: { "User-Agent": USER_AGENT },
        signal: controller.signal,
        redirect: "follow",
      });

      clearTimeout(timeout);

      if (!response.ok) {
        lastError = `HTTP ${response.status}`;
        if (response.status === 429 || response.status >= 500) {
          await sleep(RETRY_BASE_DELAY_MS * Math.pow(2, attempt));
          continue;
        }
        return null;
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // Verify it's actually a PDF (not an HTML error page)
      if (buffer.length < 1000) return null;
      const header = buffer.subarray(0, 5).toString("ascii");
      if (header !== "%PDF-") {
        // Might be a Google Drive confirmation page — try with confirm param
        if (url.includes("drive.google.com") && attempt < MAX_RETRIES) {
          await sleep(RETRY_BASE_DELAY_MS);
          continue;
        }
        return null;
      }

      return buffer;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_BASE_DELAY_MS * Math.pow(2, attempt));
      }
    }
  }

  console.error(`[Kerala SCERT] Download failed after retries: ${lastError}`);
  return null;
}

// ---------------------------------------------------------------------------
// Local storage
// ---------------------------------------------------------------------------

function getLocalPath(book: KeralaTextbook): string {
  const subjectSlug = book.subject.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const partSuffix = book.part ? `-part${book.part}` : "";
  return `data/kerala-scert/${book.grade}/${book.medium}/${subjectSlug}${partSuffix}.pdf`;
}

function savePdfLocally(book: KeralaTextbook, buffer: Buffer): void {
  const relativePath = getLocalPath(book);
  const fullPath = join(process.cwd(), relativePath);
  const dir = join(fullPath, "..");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(fullPath, buffer);
}

// ---------------------------------------------------------------------------
// Catalog filtering
// ---------------------------------------------------------------------------

function filterCatalog(options: KeralaScrapeOptions): KeralaTextbook[] {
  let books = [...KERALA_TEXTBOOK_CATALOG];

  // Grade range
  books = books.filter((b) => b.grade >= options.classStart && b.grade <= options.classEnd);

  // Medium
  if (options.medium !== "both") {
    books = books.filter((b) => b.medium === options.medium);
  }

  // Subject filter
  if (options.subjectFilter) {
    const filter = options.subjectFilter.toLowerCase();
    books = books.filter((b) =>
      b.subject.toLowerCase().includes(filter) ||
      b.subjectCode.toLowerCase().includes(filter)
    );
  }

  return books;
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

/**
 * Find or create the `standards` row for (board, grade, academicYear). The
 * academic year used to be hard-coded to "2025-26"; callers now supply it so
 * we can ingest per-session textbook catalogs side-by-side without rewriting
 * the previous year's data.
 */
async function findOrCreateStandard(
  boardId: number,
  grade: number,
  academicYear = DEFAULT_ACADEMIC_YEAR
): Promise<{ id: number } | null> {
  const [existing] = await db
    .select({ id: standards.id })
    .from(standards)
    .where(and(eq(standards.boardId, boardId), eq(standards.grade, grade), eq(standards.academicYear, academicYear)))
    .limit(1);
  if (existing) return existing;
  try {
    const [created] = await db.insert(standards)
      .values({ boardId, grade, academicYear, isActive: true, metadata: { source: "kerala_scert" } })
      .returning({ id: standards.id });
    return created ?? null;
  } catch {
    const [r] = await db.select({ id: standards.id }).from(standards)
      .where(and(eq(standards.boardId, boardId), eq(standards.grade, grade), eq(standards.academicYear, academicYear))).limit(1);
    return r ?? null;
  }
}

async function findOrCreateSubject(standardId: number, code: string, name: string): Promise<{ id: number }> {
  const [existing] = await db.select({ id: subjects.id }).from(subjects)
    .where(and(eq(subjects.standardId, standardId), eq(subjects.code, code))).limit(1);
  if (existing) return existing;
  const [created] = await db.insert(subjects)
    .values({ standardId, code, name, subjectType: "theory", isElective: false, metadata: { source: "kerala_scert" } })
    .returning({ id: subjects.id });
  return created;
}

async function findOrCreateChapter(subjectId: number, book: KeralaTextbook): Promise<{ id: number }> {
  const chNum = book.part ?? 1;
  const [existing] = await db.select({ id: chapters.id }).from(chapters)
    .where(and(eq(chapters.subjectId, subjectId), eq(chapters.chapterNumber, chNum))).limit(1);
  if (existing) return existing;
  const [created] = await db.insert(chapters).values({
    subjectId, chapterNumber: chNum, title: book.title, sortOrder: chNum,
    metadata: { source: "kerala_scert", medium: book.medium },
  }).returning({ id: chapters.id });
  return created;
}

async function findOrCreateTopic(chapterId: number, title: string): Promise<{ id: number }> {
  const [existing] = await db.select({ id: topics.id }).from(topics)
    .where(eq(topics.chapterId, chapterId)).limit(1);
  if (existing) return existing;
  const [created] = await db.insert(topics).values({
    chapterId, title, sortOrder: 1, metadata: { source: "kerala_scert" },
  }).returning({ id: topics.id });
  return created;
}

// ---------------------------------------------------------------------------
// Job helpers
// ---------------------------------------------------------------------------

async function updateJob(jobId: number, updates: Partial<{ status: string; itemsFound: number; itemsProcessed: number; errorLog: string }>): Promise<void> {
  const values: Record<string, unknown> = {};
  if (updates.status) values.status = updates.status;
  if (updates.itemsFound !== undefined) values.itemsFound = updates.itemsFound;
  if (updates.itemsProcessed !== undefined) values.itemsProcessed = updates.itemsProcessed;
  if (updates.errorLog) values.errorLog = updates.errorLog;
  if (updates.status === "running") values.startedAt = new Date();
  if (updates.status === "completed" || updates.status === "failed") values.completedAt = new Date();
  await db.update(scrapeJobs).set(values).where(eq(scrapeJobs.id, jobId));
}

async function updateJobMetadata(jobId: number, newMeta: Record<string, unknown>): Promise<void> {
  try {
    const [job] = await db.select({ metadata: scrapeJobs.metadata }).from(scrapeJobs).where(eq(scrapeJobs.id, jobId)).limit(1);
    const existing = (job?.metadata as Record<string, unknown>) ?? {};
    await db.update(scrapeJobs).set({ metadata: { ...existing, ...newMeta } }).where(eq(scrapeJobs.id, jobId));
  } catch { /* non-critical */ }
}

async function logPipeline(
  stage: string, entityId: number, status: string, data: Record<string, unknown>,
  processingTimeMs?: number, aiModelUsed?: string, aiTokensUsed?: number
): Promise<void> {
  try {
    await db.insert(contentPipelineLogs).values({
      pipelineStage: stage, entityType: "scrape_job", entityId, status, outputData: data,
      processingTimeMs: processingTimeMs ?? null, aiModelUsed: aiModelUsed ?? null, aiTokensUsed: aiTokensUsed ?? null,
    });
  } catch { /* non-critical */ }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
