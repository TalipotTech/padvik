/**
 * NCERT Textbook PDF Bulk Downloader
 *
 * Downloads actual textbook chapter PDFs from ncert.nic.in.
 * This is SEPARATE from the CBSE syllabus scraper — that scrapes syllabus
 * metadata from cbseacademic.nic.in, while this downloads textbook content.
 *
 * Source: https://ncert.nic.in/textbook.php
 * URL pattern reference: https://gist.github.com/dufferzafar/b579a6ccbf3a2b321ff9a6e5d377757a
 *
 * PDF URL pattern:
 *   https://ncert.nic.in/ncerts/l/{bookCode}/{bookCode}{chapterCode}.pdf
 *   e.g. https://ncert.nic.in/ncerts/l/jesc1/jesc101.pdf  (Class 10, Science, Ch 1)
 *
 * Book codes: {classLetter}{langLetter}{subjectCode}{bookNum}
 *   classLetter: a=1, b=2, c=3, d=4, e=5, f=6, g=7, h=8, i=9, j=10, k=11, l=12
 *   langLetter:  e=English, h=Hindi
 *   subjectCode: mh=Maths, sc=Science, ss=Social Science, en=English, etc.
 *   bookNum:     1 (usually, 2 for Part II)
 *
 * Storage: data/ncert-pdfs/{class}/{subject}/ch{num}.pdf (local dev → S3 in production)
 * Rate limit: 1 request per 3 seconds (respectful to government server)
 * After download: queue for text extraction + AI parsing via existing provider
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { eq, and, sql } from "drizzle-orm";
import { db } from "@/db";
import { boards, standards, subjects, chapters, topics } from "@/db/schema/curriculum";
import { contentItems } from "@/db/schema/content";
import { scrapeJobs, contentPipelineLogs } from "@/db/schema/system";
import { extractTextFromPdf } from "./parser";
import { aiChat, aiPdfVision, isAuthError, isQuotaError, AI_MODELS } from "../ai/provider";
import { computeQualityScore } from "../ai/quality-scorer";
import { resolveModelWithFallbacks } from "./ai-model-resolver";
import type { AIProviderChoice } from "../queue";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NCERT_BASE = "https://ncert.nic.in";
/** Correct NCERT PDF URL pattern: /textbook/pdf/{bookCode}{chapterNum}.pdf */
const NCERT_PDF_BASE = `${NCERT_BASE}/textbook/pdf`;

const RATE_LIMIT_MS = 3000; // 1 request per 3 seconds
const REQUEST_TIMEOUT_MS = 45000; // 45s — NCERT server is slow
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 5000;

const USER_AGENT =
  "Mozilla/5.0 (compatible; PadvikBot/1.0; +https://padvik.in/bot; educational-content)";

const DATA_DIR = join(process.cwd(), "data", "ncert-pdfs");

// ---------------------------------------------------------------------------
// Class letter mapping: grade → letter in NCERT book codes
// ---------------------------------------------------------------------------

const CLASS_LETTER: Record<number, string> = {
  1: "a", 2: "b", 3: "c", 4: "d", 5: "e", 6: "f",
  7: "g", 8: "h", 9: "i", 10: "j", 11: "k", 12: "l",
};

const LANG_LETTER: Record<string, string> = {
  en: "e",
  hi: "h",
};

// ---------------------------------------------------------------------------
// NCERT Book Catalog — comprehensive listing for Classes 1-12
// ---------------------------------------------------------------------------

export interface NcertBook {
  /** NCERT book code, e.g. "jesc1" */
  code: string;
  /** Human-readable name */
  name: string;
  /** Grade / class number */
  grade: number;
  /** Subject category for our DB */
  subject: string;
  /** Normalized subject code */
  subjectCode: string;
  /** Language: "en" or "hi" */
  language: string;
  /** Number of chapters */
  chapters: number;
  /** NEP name if renamed under NEP 2020, e.g. "Curiosity" for Class 6 Science */
  nepName?: string;
}

/**
 * Complete NCERT textbook catalog.
 * Derived from https://ncert.nic.in/textbook.php and
 * https://gist.github.com/dufferzafar/b579a6ccbf3a2b321ff9a6e5d377757a
 *
 * Format: { code, name, grade, subject, subjectCode, language, chapters, nepName? }
 */
export const NCERT_BOOK_CATALOG: NcertBook[] = [
  // ── Class 1 ─────────────────────────────────────────────────
  { code: "aemh1", name: "Math-Magic", grade: 1, subject: "Mathematics", subjectCode: "MATHS", language: "en", chapters: 13 },
  { code: "aeen1", name: "Marigold", grade: 1, subject: "English", subjectCode: "ENGLISH", language: "en", chapters: 10 },
  { code: "ahmh1", name: "Ganit Ka Jaadu", grade: 1, subject: "Mathematics", subjectCode: "MATHS", language: "hi", chapters: 13 },

  // ── Class 2 ─────────────────────────────────────────────────
  { code: "bemh1", name: "Math-Magic", grade: 2, subject: "Mathematics", subjectCode: "MATHS", language: "en", chapters: 15 },
  { code: "been1", name: "Marigold", grade: 2, subject: "English", subjectCode: "ENGLISH", language: "en", chapters: 9 },
  { code: "bhmh1", name: "Ganit Ka Jaadu", grade: 2, subject: "Mathematics", subjectCode: "MATHS", language: "hi", chapters: 15 },

  // ── Class 3 ─────────────────────────────────────────────────
  { code: "cemh1", name: "Math-Magic", grade: 3, subject: "Mathematics", subjectCode: "MATHS", language: "en", chapters: 14 },
  { code: "ceev1", name: "Looking Around (EVS)", grade: 3, subject: "Environmental Studies", subjectCode: "EVS", language: "en", chapters: 24 },
  { code: "ceen1", name: "Marigold", grade: 3, subject: "English", subjectCode: "ENGLISH", language: "en", chapters: 10 },
  { code: "chmh1", name: "Ganit Ka Jaadu", grade: 3, subject: "Mathematics", subjectCode: "MATHS", language: "hi", chapters: 14 },

  // ── Class 4 ─────────────────────────────────────────────────
  { code: "demh1", name: "Math-Magic", grade: 4, subject: "Mathematics", subjectCode: "MATHS", language: "en", chapters: 14 },
  { code: "deev1", name: "Looking Around (EVS)", grade: 4, subject: "Environmental Studies", subjectCode: "EVS", language: "en", chapters: 27 },
  { code: "deen1", name: "Marigold", grade: 4, subject: "English", subjectCode: "ENGLISH", language: "en", chapters: 9 },
  { code: "dhmh1", name: "Ganit Ka Jaadu", grade: 4, subject: "Mathematics", subjectCode: "MATHS", language: "hi", chapters: 14 },

  // ── Class 5 ─────────────────────────────────────────────────
  { code: "eemh1", name: "Math-Magic", grade: 5, subject: "Mathematics", subjectCode: "MATHS", language: "en", chapters: 14 },
  { code: "eeev1", name: "Looking Around (EVS)", grade: 5, subject: "Environmental Studies", subjectCode: "EVS", language: "en", chapters: 22 },
  { code: "eeen1", name: "Marigold", grade: 5, subject: "English", subjectCode: "ENGLISH", language: "en", chapters: 10 },
  { code: "ehmh1", name: "Ganit Ka Jaadu", grade: 5, subject: "Mathematics", subjectCode: "MATHS", language: "hi", chapters: 14 },

  // ── Class 6 (NEP 2020 renamed books) ───────────────────────
  { code: "femh1", name: "Mathematics", grade: 6, subject: "Mathematics", subjectCode: "MATHS", language: "en", chapters: 14, nepName: "Ganita Prakash" },
  { code: "fesc1", name: "Science", grade: 6, subject: "Science", subjectCode: "SCIENCE", language: "en", chapters: 12, nepName: "Curiosity" },
  { code: "fess1", name: "Social Science", grade: 6, subject: "Social Science", subjectCode: "SOCIAL_SCIENCE", language: "en", chapters: 12, nepName: "Exploring Society — India and Beyond" },
  { code: "feen1", name: "Honeysuckle (English)", grade: 6, subject: "English", subjectCode: "ENGLISH", language: "en", chapters: 10 },
  { code: "feen2", name: "A Pact with the Sun (Suppl.)", grade: 6, subject: "English", subjectCode: "ENGLISH_SUPP", language: "en", chapters: 10 },
  { code: "fhmh1", name: "Ganit", grade: 6, subject: "Mathematics", subjectCode: "MATHS", language: "hi", chapters: 14, nepName: "Ganita Prakash" },
  { code: "fhsc1", name: "Vigyan", grade: 6, subject: "Science", subjectCode: "SCIENCE", language: "hi", chapters: 12, nepName: "Jigyasa" },

  // ── Class 7 ─────────────────────────────────────────────────
  { code: "gemh1", name: "Mathematics", grade: 7, subject: "Mathematics", subjectCode: "MATHS", language: "en", chapters: 15 },
  { code: "gesc1", name: "Science", grade: 7, subject: "Science", subjectCode: "SCIENCE", language: "en", chapters: 18 },
  { code: "gess1", name: "Social and Political Life - II", grade: 7, subject: "Social Science", subjectCode: "SOCIAL_SCIENCE", language: "en", chapters: 9 },
  { code: "gess2", name: "Our Pasts - II (History)", grade: 7, subject: "History", subjectCode: "HISTORY", language: "en", chapters: 10 },
  { code: "gess3", name: "Our Environment (Geography)", grade: 7, subject: "Geography", subjectCode: "GEOGRAPHY", language: "en", chapters: 9 },
  { code: "geen1", name: "Honeycomb (English)", grade: 7, subject: "English", subjectCode: "ENGLISH", language: "en", chapters: 10 },
  { code: "geen2", name: "An Alien Hand (Suppl.)", grade: 7, subject: "English", subjectCode: "ENGLISH_SUPP", language: "en", chapters: 10 },
  { code: "ghmh1", name: "Ganit", grade: 7, subject: "Mathematics", subjectCode: "MATHS", language: "hi", chapters: 15 },
  { code: "ghsc1", name: "Vigyan", grade: 7, subject: "Science", subjectCode: "SCIENCE", language: "hi", chapters: 18 },

  // ── Class 8 ─────────────────────────────────────────────────
  { code: "hemh1", name: "Mathematics", grade: 8, subject: "Mathematics", subjectCode: "MATHS", language: "en", chapters: 16 },
  { code: "hesc1", name: "Science", grade: 8, subject: "Science", subjectCode: "SCIENCE", language: "en", chapters: 18 },
  { code: "hess1", name: "Social and Political Life - III", grade: 8, subject: "Social Science", subjectCode: "SOCIAL_SCIENCE", language: "en", chapters: 10 },
  { code: "hess2", name: "Our Pasts - III (History)", grade: 8, subject: "History", subjectCode: "HISTORY", language: "en", chapters: 12 },
  { code: "hess3", name: "Resources and Development (Geo)", grade: 8, subject: "Geography", subjectCode: "GEOGRAPHY", language: "en", chapters: 6 },
  { code: "heen1", name: "Honeydew (English)", grade: 8, subject: "English", subjectCode: "ENGLISH", language: "en", chapters: 10 },
  { code: "heen2", name: "It So Happened (Suppl.)", grade: 8, subject: "English", subjectCode: "ENGLISH_SUPP", language: "en", chapters: 11 },
  { code: "hhmh1", name: "Ganit", grade: 8, subject: "Mathematics", subjectCode: "MATHS", language: "hi", chapters: 16 },
  { code: "hhsc1", name: "Vigyan", grade: 8, subject: "Science", subjectCode: "SCIENCE", language: "hi", chapters: 18 },

  // ── Class 9 ─────────────────────────────────────────────────
  // Note: iemh1 / iesc1 historically shipped as 15-chapter books, but the
  // current NCERT online edition serves only ch01-ch12 at /textbook/pdf.
  // iess1 (Democratic Politics - I) has 4 chapters in the current edition;
  // requesting ch05-ch06 against NCERT silently returns iess3 (Geography)
  // content, so we MUST cap the count at the true value.
  { code: "iemh1", name: "Mathematics", grade: 9, subject: "Mathematics", subjectCode: "MATHS", language: "en", chapters: 12 },
  { code: "iesc1", name: "Science", grade: 9, subject: "Science", subjectCode: "SCIENCE", language: "en", chapters: 12 },
  { code: "iess1", name: "Democratic Politics - I", grade: 9, subject: "Political Science", subjectCode: "POL_SCIENCE", language: "en", chapters: 4 },
  { code: "iess2", name: "India and the Contemporary World - I", grade: 9, subject: "History", subjectCode: "HISTORY", language: "en", chapters: 5 },
  { code: "iess3", name: "Contemporary India - I (Geo)", grade: 9, subject: "Geography", subjectCode: "GEOGRAPHY", language: "en", chapters: 6 },
  { code: "iess4", name: "Economics", grade: 9, subject: "Economics", subjectCode: "ECONOMICS", language: "en", chapters: 4 },
  { code: "ieen1", name: "Beehive (English)", grade: 9, subject: "English", subjectCode: "ENGLISH", language: "en", chapters: 11 },
  { code: "ieen2", name: "Moments (Suppl.)", grade: 9, subject: "English", subjectCode: "ENGLISH_SUPP", language: "en", chapters: 10 },
  { code: "ihmh1", name: "Ganit", grade: 9, subject: "Mathematics", subjectCode: "MATHS", language: "hi", chapters: 12 },
  { code: "ihsc1", name: "Vigyan", grade: 9, subject: "Science", subjectCode: "SCIENCE", language: "hi", chapters: 12 },

  // ── Class 10 ────────────────────────────────────────────────
  // IMPORTANT — the jess[1-4] book codes at /textbook/pdf are rotated vs.
  // the legacy labels once used for this catalog. NCERT actually serves:
  //   jess1 → Contemporary India - II (Geography, 7 ch)
  //   jess2 → Understanding Economic Development (Economics, 5 ch)
  //   jess3 → India and the Contemporary World - II (History, 5 ch)
  //   jess4 → Democratic Politics - II (Political Science, 5 ch)
  // Verified 2026-04 by inspecting AI-extracted H1 titles from each URL.
  // NCERT_CODE_INVARIANTS must match these slugs.
  { code: "jemh1", name: "Mathematics", grade: 10, subject: "Mathematics", subjectCode: "MATHS", language: "en", chapters: 14 },
  { code: "jesc1", name: "Science", grade: 10, subject: "Science", subjectCode: "SCIENCE", language: "en", chapters: 13 },
  { code: "jess1", name: "Contemporary India - II (Geo)", grade: 10, subject: "Geography", subjectCode: "GEOGRAPHY", language: "en", chapters: 7 },
  { code: "jess2", name: "Understanding Economic Development", grade: 10, subject: "Economics", subjectCode: "ECONOMICS", language: "en", chapters: 5 },
  { code: "jess3", name: "India and the Contemporary World - II", grade: 10, subject: "History", subjectCode: "HISTORY", language: "en", chapters: 5 },
  { code: "jess4", name: "Democratic Politics - II", grade: 10, subject: "Political Science", subjectCode: "POL_SCIENCE", language: "en", chapters: 5 },
  { code: "jeen1", name: "First Flight (English)", grade: 10, subject: "English", subjectCode: "ENGLISH", language: "en", chapters: 11 },
  { code: "jeen2", name: "Footprints without Feet (Suppl.)", grade: 10, subject: "English", subjectCode: "ENGLISH_SUPP", language: "en", chapters: 10 },
  { code: "jhmh1", name: "Ganit", grade: 10, subject: "Mathematics", subjectCode: "MATHS", language: "hi", chapters: 14 },
  { code: "jhsc1", name: "Vigyan", grade: 10, subject: "Science", subjectCode: "SCIENCE", language: "hi", chapters: 13 },

  // ── Class 11 ────────────────────────────────────────────────
  { code: "kemh1", name: "Mathematics", grade: 11, subject: "Mathematics", subjectCode: "MATHS", language: "en", chapters: 16 },
  { code: "keph1", name: "Physics Part I", grade: 11, subject: "Physics", subjectCode: "PHYSICS", language: "en", chapters: 8 },
  { code: "keph2", name: "Physics Part II", grade: 11, subject: "Physics (Part II)", subjectCode: "PHYSICS_2", language: "en", chapters: 7 },
  { code: "kech1", name: "Chemistry Part I", grade: 11, subject: "Chemistry", subjectCode: "CHEMISTRY", language: "en", chapters: 7 },
  // NEP 2023 post-rationalization: kech2 dropped from 7 → 3 real chapters (verified 2026-04)
  { code: "kech2", name: "Chemistry Part II", grade: 11, subject: "Chemistry (Part II)", subjectCode: "CHEMISTRY_2", language: "en", chapters: 3 },
  { code: "kebo1", name: "Biology", grade: 11, subject: "Biology", subjectCode: "BIOLOGY", language: "en", chapters: 22 },
  // NEP 2023 post-rationalization: keac1 15→7 real chapters, keac2 6→2 (verified 2026-04 via DB actuals)
  { code: "keac1", name: "Accountancy Part I", grade: 11, subject: "Accountancy", subjectCode: "ACCOUNTANCY", language: "en", chapters: 7 },
  { code: "keac2", name: "Accountancy Part II", grade: 11, subject: "Accountancy (Part II)", subjectCode: "ACCOUNTANCY_2", language: "en", chapters: 2 },
  { code: "kest1", name: "Statistics for Economics", grade: 11, subject: "Statistics", subjectCode: "STATISTICS", language: "en", chapters: 9 },
  // NEP 2023 post-rationalization: keec1 10 → 8 real chapters (verified 2026-04)
  { code: "keec1", name: "Indian Economic Development", grade: 11, subject: "Economics", subjectCode: "ECONOMICS", language: "en", chapters: 8 },
  // Class 11 Geography + Sociology — NCERT codes verified 2026-04 by H1 extraction.
  //   kegy1 = "India - Physical Environment" (Geography, NOT Sociology — prior catalog was wrong)
  //   kegy2 = "Fundamentals of Physical Geography"
  //   kesy1 = "Introducing Sociology"
  //   kesy2 = "Understanding Society"
  // NCERT_CODE_INVARIANTS must match these slugs.
  { code: "kegy1", name: "India - Physical Environment (Geo I)", grade: 11, subject: "Geography", subjectCode: "GEOGRAPHY", language: "en", chapters: 6 },
  { code: "kegy2", name: "Fundamentals of Physical Geography", grade: 11, subject: "Geography (Part II)", subjectCode: "GEOGRAPHY_2", language: "en", chapters: 14 },
  { code: "kesy1", name: "Introducing Sociology", grade: 11, subject: "Sociology", subjectCode: "SOCIOLOGY", language: "en", chapters: 5 },
  { code: "kesy2", name: "Understanding Society", grade: 11, subject: "Sociology (Part II)", subjectCode: "SOCIOLOGY_2", language: "en", chapters: 5 },
  // NEP 2023 post-rationalization: keps1 10 → 8 real chapters (verified 2026-04)
  { code: "keps1", name: "Political Theory", grade: 11, subject: "Political Science", subjectCode: "POL_SCIENCE", language: "en", chapters: 8 },
  { code: "keps2", name: "Indian Constitution at Work", grade: 11, subject: "Political Science (Part II)", subjectCode: "POL_SCIENCE_2", language: "en", chapters: 10 },
  // NEP 2023 post-rationalization: kehs1 11 → 7 real chapters (verified 2026-04)
  { code: "kehs1", name: "Themes in World History", grade: 11, subject: "History", subjectCode: "HISTORY", language: "en", chapters: 7 },
  { code: "keen1", name: "Hornbill (English Core)", grade: 11, subject: "English", subjectCode: "ENGLISH", language: "en", chapters: 8 },
  { code: "keen2", name: "Snapshots (Suppl.)", grade: 11, subject: "English (Supplementary)", subjectCode: "ENGLISH_SUPP", language: "en", chapters: 8 },
  { code: "khmh1", name: "Ganit", grade: 11, subject: "Mathematics", subjectCode: "MATHS", language: "hi", chapters: 16 },
  { code: "khph1", name: "Bhautiki Part I", grade: 11, subject: "Physics", subjectCode: "PHYSICS", language: "hi", chapters: 8 },
  { code: "khch1", name: "Rasayan Vigyan Part I", grade: 11, subject: "Chemistry", subjectCode: "CHEMISTRY", language: "hi", chapters: 7 },
  { code: "khbo1", name: "Jeev Vigyan", grade: 11, subject: "Biology", subjectCode: "BIOLOGY", language: "hi", chapters: 22 },

  // ── Class 12 ────────────────────────────────────────────────
  { code: "lemh1", name: "Mathematics Part I", grade: 12, subject: "Mathematics", subjectCode: "MATHS", language: "en", chapters: 6 },
  { code: "lemh2", name: "Mathematics Part II", grade: 12, subject: "Mathematics (Part II)", subjectCode: "MATHS_2", language: "en", chapters: 7 },
  { code: "leph1", name: "Physics Part I", grade: 12, subject: "Physics", subjectCode: "PHYSICS", language: "en", chapters: 8 },
  { code: "leph2", name: "Physics Part II", grade: 12, subject: "Physics (Part II)", subjectCode: "PHYSICS_2", language: "en", chapters: 6 },
  { code: "lech1", name: "Chemistry Part I", grade: 12, subject: "Chemistry", subjectCode: "CHEMISTRY", language: "en", chapters: 10 },
  { code: "lech2", name: "Chemistry Part II", grade: 12, subject: "Chemistry (Part II)", subjectCode: "CHEMISTRY_2", language: "en", chapters: 6 },
  // NEP 2023 post-rationalization (verified 2026-04 via DB actuals):
  //   lebo1 16→13, leac1 6→4, leec2 6→5
  { code: "lebo1", name: "Biology", grade: 12, subject: "Biology", subjectCode: "BIOLOGY", language: "en", chapters: 13 },
  { code: "leac1", name: "Accountancy Part I", grade: 12, subject: "Accountancy", subjectCode: "ACCOUNTANCY", language: "en", chapters: 4 },
  { code: "leac2", name: "Accountancy Part II", grade: 12, subject: "Accountancy (Part II)", subjectCode: "ACCOUNTANCY_2", language: "en", chapters: 6 },
  { code: "leec1", name: "Introductory Microeconomics", grade: 12, subject: "Economics", subjectCode: "ECONOMICS", language: "en", chapters: 6 },
  { code: "leec2", name: "Introductory Macroeconomics", grade: 12, subject: "Economics (Part II)", subjectCode: "ECONOMICS_2", language: "en", chapters: 5 },
  // Class 12 Geography + Sociology — NCERT codes verified 2026-04 by H1 extraction.
  //   legy1 = "Fundamentals of Human Geography" (Geography, NOT Sociology — prior catalog was wrong,
  //           same mislabel pattern as Gr11 kegy1)
  //   legy2 = "India - People and Economy" (Geography Part II)
  //   lesy1 = "Indian Society" (real Sociology I)
  //   lesy2 = "Social Change and Development in India" (Sociology II)
  //   lebs1 = "Business Studies Part I" (Principles and Functions of Management)
  //   lebs2 = "Business Studies Part II" (Business Finance and Marketing) — only 3 real chapters
  //   lepy1 = "Psychology"
  { code: "legy1", name: "Fundamentals of Human Geography", grade: 12, subject: "Geography", subjectCode: "GEOGRAPHY", language: "en", chapters: 8 },
  { code: "legy2", name: "India - People and Economy", grade: 12, subject: "Geography (Part II)", subjectCode: "GEOGRAPHY_2", language: "en", chapters: 9 },
  { code: "lesy1", name: "Indian Society", grade: 12, subject: "Sociology", subjectCode: "SOCIOLOGY", language: "en", chapters: 7 },
  { code: "lesy2", name: "Social Change and Development in India", grade: 12, subject: "Sociology (Part II)", subjectCode: "SOCIOLOGY_2", language: "en", chapters: 8 },
  { code: "lebs1", name: "Business Studies Part I (Management)", grade: 12, subject: "Business Studies", subjectCode: "BUSINESS_STUDIES", language: "en", chapters: 8 },
  { code: "lebs2", name: "Business Studies Part II (Finance & Marketing)", grade: 12, subject: "Business Studies (Part II)", subjectCode: "BUSINESS_STUDIES_2", language: "en", chapters: 3 },
  { code: "lepy1", name: "Psychology", grade: 12, subject: "Psychology", subjectCode: "PSYCHOLOGY", language: "en", chapters: 7 },
  // NEP 2023 post-rationalization (verified 2026-04 via DB actuals):
  //   leps1 9→7, leps2 9→8, lehs2 5→4, lehs3 6→4
  { code: "leps1", name: "Contemporary World Politics", grade: 12, subject: "Political Science", subjectCode: "POL_SCIENCE", language: "en", chapters: 7 },
  { code: "leps2", name: "Politics in India since Independence", grade: 12, subject: "Political Science (Part II)", subjectCode: "POL_SCIENCE_2", language: "en", chapters: 8 },
  { code: "lehs1", name: "Themes in Indian History - I", grade: 12, subject: "History", subjectCode: "HISTORY", language: "en", chapters: 4 },
  { code: "lehs2", name: "Themes in Indian History - II", grade: 12, subject: "History (Part II)", subjectCode: "HISTORY_2", language: "en", chapters: 4 },
  { code: "lehs3", name: "Themes in Indian History - III", grade: 12, subject: "History (Part III)", subjectCode: "HISTORY_3", language: "en", chapters: 4 },
  { code: "leen1", name: "Flamingo (English Core)", grade: 12, subject: "English", subjectCode: "ENGLISH", language: "en", chapters: 8 },
  { code: "leen2", name: "Vistas (Suppl.)", grade: 12, subject: "English (Supplementary)", subjectCode: "ENGLISH_SUPP", language: "en", chapters: 8 },
  { code: "lhmh1", name: "Ganit Part I", grade: 12, subject: "Mathematics", subjectCode: "MATHS", language: "hi", chapters: 6 },
  { code: "lhmh2", name: "Ganit Part II", grade: 12, subject: "Mathematics (Part II)", subjectCode: "MATHS_2", language: "hi", chapters: 7 },
  { code: "lhph1", name: "Bhautiki Part I", grade: 12, subject: "Physics", subjectCode: "PHYSICS", language: "hi", chapters: 8 },
  { code: "lhch1", name: "Rasayan Vigyan Part I", grade: 12, subject: "Chemistry", subjectCode: "CHEMISTRY", language: "hi", chapters: 10 },
  { code: "lhbo1", name: "Jeev Vigyan", grade: 12, subject: "Biology", subjectCode: "BIOLOGY", language: "hi", chapters: 16 },
];

// ---------------------------------------------------------------------------
// Frozen code→slug invariants — IMMUTABLE source of truth for filing paths
// ---------------------------------------------------------------------------
//
// Each NCERT book code is a stable NCERT-assigned identifier (iess1, jesc1…)
// that cannot drift without also breaking the download URL. These invariants
// pin the directory slug for each code so that accidental edits to the
// mutable `subject` label in NCERT_BOOK_CATALOG can never silently misfile
// downloaded PDFs under a wrong subject directory.
//
// History: a prior mis-edit to NCERT_BOOK_CATALOG had swapped the `subject`
// field between iess1–4 (Class 9 social sciences), causing a 4-cycle rotation
// of chapter PDFs across political-science/history/geography/economics
// directories. This table is the defensive backstop against recurrence.
//
// DO NOT edit a slug after files have been downloaded under it.
// DO add a new entry when adding a new code to NCERT_BOOK_CATALOG.
export const NCERT_CODE_INVARIANTS: Readonly<Record<string, string>> = Object.freeze({
  // Class 1
  aemh1: "mathematics", aeen1: "english", ahmh1: "mathematics",
  // Class 2
  bemh1: "mathematics", been1: "english", bhmh1: "mathematics",
  // Class 3
  cemh1: "mathematics", ceev1: "environmental-studies", ceen1: "english", chmh1: "mathematics",
  // Class 4
  demh1: "mathematics", deev1: "environmental-studies", deen1: "english", dhmh1: "mathematics",
  // Class 5
  eemh1: "mathematics", eeev1: "environmental-studies", eeen1: "english", ehmh1: "mathematics",
  // Class 6
  femh1: "mathematics", fesc1: "science", fess1: "social-science",
  feen1: "english", feen2: "english", fhmh1: "mathematics", fhsc1: "science",
  // Class 7
  gemh1: "mathematics", gesc1: "science", gess1: "social-science",
  gess2: "history", gess3: "geography", geen1: "english", geen2: "english",
  ghmh1: "mathematics", ghsc1: "science",
  // Class 8
  hemh1: "mathematics", hesc1: "science", hess1: "social-science",
  hess2: "history", hess3: "geography", heen1: "english", heen2: "english",
  hhmh1: "mathematics", hhsc1: "science",
  // Class 9
  iemh1: "mathematics", iesc1: "science",
  iess1: "political-science", iess2: "history", iess3: "geography", iess4: "economics",
  ieen1: "english", ieen2: "english", ihmh1: "mathematics", ihsc1: "science",
  // Class 10
  //   jess1 = Geography (Contemporary India II),
  //   jess2 = Economics (Understanding Economic Development),
  //   jess3 = History (India and the Contemporary World II),
  //   jess4 = Political Science (Democratic Politics II).
  // These slugs MUST match what NCERT actually serves at /textbook/pdf/{code}{chapter}.pdf
  // (verified 2026-04 by H1-heading extraction). Do not revert to the legacy label mapping.
  jemh1: "mathematics", jesc1: "science",
  jess1: "geography", jess2: "economics", jess3: "history", jess4: "political-science",
  jeen1: "english", jeen2: "english", jhmh1: "mathematics", jhsc1: "science",
  // Class 11
  //   kegy1 = Geography ("India - Physical Environment"), kegy2 = Geography ("Fundamentals of Physical Geography")
  //   kesy1 = Sociology ("Introducing Sociology"), kesy2 = Sociology ("Understanding Society")
  // Verified 2026-04 by H1 extraction (prior catalog mislabeled kegy1 as Sociology).
  kemh1: "mathematics", keph1: "physics", keph2: "physics",
  kech1: "chemistry", kech2: "chemistry", kebo1: "biology",
  keac1: "accountancy", keac2: "accountancy", kest1: "statistics",
  keec1: "economics",
  kegy1: "geography", kegy2: "geography",
  kesy1: "sociology", kesy2: "sociology",
  keps1: "political-science", keps2: "political-science", kehs1: "history",
  keen1: "english", keen2: "english",
  khmh1: "mathematics", khph1: "physics", khch1: "chemistry", khbo1: "biology",
  // Class 12
  //   legy1 = Geography ("Fundamentals of Human Geography"), legy2 = Geography ("India - People and Economy")
  //   lesy1 = Sociology ("Indian Society"), lesy2 = Sociology ("Social Change and Development in India")
  //   lebs1 + lebs2 = Business Studies
  //   lepy1 = Psychology
  lemh1: "mathematics", lemh2: "mathematics", leph1: "physics", leph2: "physics",
  lech1: "chemistry", lech2: "chemistry", lebo1: "biology",
  leac1: "accountancy", leac2: "accountancy",
  leec1: "economics", leec2: "economics",
  legy1: "geography", legy2: "geography",
  lesy1: "sociology", lesy2: "sociology",
  lebs1: "business-studies", lebs2: "business-studies",
  lepy1: "psychology",
  leps1: "political-science", leps2: "political-science",
  lehs1: "history", lehs2: "history", lehs3: "history",
  leen1: "english", leen2: "english",
  lhmh1: "mathematics", lhmh2: "mathematics", lhph1: "physics",
  lhch1: "chemistry", lhbo1: "biology",
});

/**
 * Returns the canonical directory slug for a book. Always use this — never
 * derive the slug from `book.subject` directly, since that field is mutable
 * and a mis-edit can silently misfile PDFs under the wrong directory.
 */
export function getCanonicalSubjectSlug(code: string): string {
  const slug = NCERT_CODE_INVARIANTS[code];
  if (!slug) {
    throw new Error(
      `[ncert-downloader] No canonical slug invariant for book code "${code}". ` +
        `Add an entry to NCERT_CODE_INVARIANTS before downloading.`
    );
  }
  return slug;
}

/**
 * Validates NCERT_BOOK_CATALOG against NCERT_CODE_INVARIANTS and the code's
 * class/language letter prefix. Runs at the top of runNcertDownload and
 * throws loudly on any drift so catalog edits can't silently misfile PDFs.
 */
export function validateCatalogInvariants(): void {
  const errors: string[] = [];
  const seenCodes = new Set<string>();

  // Inverse lookup: class letter → grade, lang letter → language
  const letterToGrade: Record<string, number> = {};
  for (const [g, l] of Object.entries(CLASS_LETTER)) letterToGrade[l] = Number(g);
  const letterToLang: Record<string, string> = {};
  for (const [lang, l] of Object.entries(LANG_LETTER)) letterToLang[l] = lang;

  for (const book of NCERT_BOOK_CATALOG) {
    // Duplicate code check
    if (seenCodes.has(book.code)) {
      errors.push(`Duplicate code "${book.code}" in NCERT_BOOK_CATALOG`);
      continue;
    }
    seenCodes.add(book.code);

    // Code must have an invariant entry
    const invariantSlug = NCERT_CODE_INVARIANTS[book.code];
    if (!invariantSlug) {
      errors.push(`Code "${book.code}" (${book.subject}) has no entry in NCERT_CODE_INVARIANTS`);
      continue;
    }

    // Derive slug from current subject label and compare to invariant.
    // Strip Part-II / Supplementary disambiguators so multi-part books (which share
    // the same underlying subject / file-path slug) can have distinct subject names
    // in the catalog without failing the invariant check.
    //   "Physics (Part II)" → "Physics" → "physics"
    //   "English (Supplementary)" → "English" → "english"
    //   "Mathematics (Part II)" → "Mathematics" → "mathematics"
    const cleanSubject = book.subject
      .replace(/\s*\(Part\s+[IVX]+\)\s*/i, "")
      .replace(/\s*\(Supplementary\)\s*/i, "")
      .trim();
    const derivedSlug = cleanSubject.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    if (derivedSlug !== invariantSlug) {
      errors.push(
        `Code "${book.code}": subject="${book.subject}" (cleaned "${cleanSubject}") → slug "${derivedSlug}" ` +
          `disagrees with invariant "${invariantSlug}". ` +
          `Either the catalog label was mis-edited or the invariant needs updating.`
      );
    }

    // Code prefix must encode grade + language correctly
    if (book.code.length < 2) {
      errors.push(`Code "${book.code}" is too short to encode class+language letters`);
      continue;
    }
    const classLetter = book.code[0];
    const langLetter = book.code[1];
    const expectedGrade = letterToGrade[classLetter];
    const expectedLang = letterToLang[langLetter];
    if (expectedGrade !== book.grade) {
      errors.push(
        `Code "${book.code}": class letter "${classLetter}" encodes grade ${expectedGrade} ` +
          `but book.grade is ${book.grade}`
      );
    }
    if (expectedLang !== book.language) {
      errors.push(
        `Code "${book.code}": lang letter "${langLetter}" encodes "${expectedLang}" ` +
          `but book.language is "${book.language}"`
      );
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `NCERT catalog invariant validation failed (${errors.length} error${errors.length === 1 ? "" : "s"}):\n  - ` +
        errors.join("\n  - ")
    );
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NcertDownloadOptions {
  grades?: number[];
  subjects?: string[];
  /**
   * Exact NCERT book-code filter (e.g. ["keph1","keph2"]). When set, only
   * books whose `code` is in this list are selected — `subjects` is ignored
   * for matching. Prefer this over `subjects` when the caller already
   * iterates book-by-book, since `subjects` matches by substring and
   * multi-part subjects (Physics Part I + Part II) both match "Physics",
   * making a global `maxChapters` cap silently skip the later book.
   */
  bookCodes?: string[];
  languages?: ("en" | "hi")[];
  jobId?: number;
  aiProvider?: AIProviderChoice;
  /** Max total chapters to download (for testing/cost control) */
  maxChapters?: number;
  /** Skip AI parsing — only download PDFs */
  downloadOnly?: boolean;
  /** Resume: skip already-downloaded files */
  resume?: boolean;
}

export interface NcertDownloadResult {
  booksProcessed: number;
  chaptersDownloaded: number;
  chaptersFailed: number;
  chaptersSkipped: number;
  chaptersParsed: number;
  totalBytes: number;
  errors: string[];
  processedBooks: string[];
}

// ---------------------------------------------------------------------------
// Main downloader
// ---------------------------------------------------------------------------

export async function runNcertDownload(options: NcertDownloadOptions): Promise<NcertDownloadResult> {
  const log = (msg: string) => console.log(`[NCERT Download] ${msg}`);

  const result: NcertDownloadResult = {
    booksProcessed: 0,
    chaptersDownloaded: 0,
    chaptersFailed: 0,
    chaptersSkipped: 0,
    chaptersParsed: 0,
    totalBytes: 0,
    errors: [],
    processedBooks: [],
  };

  const { jobId } = options;
  let totalChaptersProcessed = 0;
  const maxChapters = options.maxChapters ?? Infinity;

  try {
    // Fail fast on any catalog drift (code↔slug/grade/language invariants).
    // Catches past-style bugs where mutable `subject` labels are edited and
    // PDFs end up silently saved under the wrong directory.
    validateCatalogInvariants();

    // Resolve CBSE board in DB
    const [board] = await db
      .select()
      .from(boards)
      .where(eq(boards.code, "CBSE"))
      .limit(1);

    if (!board) {
      throw new Error("CBSE board not found in database. Run seed first.");
    }

    if (jobId) {
      await updateJob(jobId, { status: "running" });
    }

    // Filter catalog
    const filteredBooks = filterCatalog(options);
    const totalChaptersExpected = filteredBooks.reduce((sum, b) => sum + b.chapters, 0);
    log(`Selected ${filteredBooks.length} books (${totalChaptersExpected} chapters total)`);

    if (jobId) {
      await updateJob(jobId, { itemsFound: Math.min(totalChaptersExpected, maxChapters) });
    }

    // Process each book
    for (const book of filteredBooks) {
      if (totalChaptersProcessed >= maxChapters) break;

      log(`\n── ${book.name} (Class ${book.grade}, ${book.language.toUpperCase()}) [${book.code}] ──`);

      const remaining = maxChapters - totalChaptersProcessed;
      const chaptersToDownload = Math.min(book.chapters, remaining);

      const bookResult = await processBook(
        book,
        chaptersToDownload,
        board.id,
        options,
        log
      );

      result.chaptersDownloaded += bookResult.downloaded;
      result.chaptersFailed += bookResult.failed;
      result.chaptersSkipped += bookResult.skipped;
      result.chaptersParsed += bookResult.parsed;
      result.totalBytes += bookResult.bytes;
      result.errors.push(...bookResult.errors);
      result.booksProcessed++;
      result.processedBooks.push(book.code);

      totalChaptersProcessed += bookResult.downloaded + bookResult.failed + bookResult.skipped;

      if (jobId) {
        await updateJob(jobId, { itemsProcessed: totalChaptersProcessed });
      }
    }

    // Summary
    log(`\n=== NCERT Download Summary ===`);
    log(`Books: ${result.booksProcessed} | Chapters: ${result.chaptersDownloaded} downloaded, ${result.chaptersFailed} failed, ${result.chaptersSkipped} skipped`);
    log(`Parsed: ${result.chaptersParsed} | Total size: ${(result.totalBytes / 1024 / 1024).toFixed(1)} MB`);
    if (result.errors.length > 0) {
      log(`Errors: ${result.errors.length}`);
    }

    if (jobId) {
      await updateJob(jobId, { status: "completed" });
      await updateJobMetadata(jobId, { downloadResult: result });
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

interface BookProcessResult {
  downloaded: number;
  failed: number;
  skipped: number;
  parsed: number;
  bytes: number;
  errors: string[];
}

async function processBook(
  book: NcertBook,
  maxChapters: number,
  boardId: number,
  options: NcertDownloadOptions,
  log: (msg: string) => void
): Promise<BookProcessResult> {
  const result: BookProcessResult = {
    downloaded: 0, failed: 0, skipped: 0, parsed: 0, bytes: 0, errors: [],
  };

  let lastRequestTime = 0;

  for (let ch = 1; ch <= maxChapters; ch++) {
    const chapterCode = ch.toString().padStart(2, "0");
    // Correct pattern: https://ncert.nic.in/textbook/pdf/jemh101.pdf
    const pdfUrl = `${NCERT_PDF_BASE}/${book.code}${chapterCode}.pdf`;
    const localPath = getLocalPath(book, ch);

    // Resume support: if PDF already exists on disk (new book-code-nested
    // path or legacy flat path), skip the download step but STILL run the
    // AI parse pass. parseAndStoreChapter dedupes by source_url, so
    // already-parsed chapters are free; chapters with PDF-but-no-content
    // get parsed.
    if (options.resume) {
      const existingPath = resolveExistingLocalPath(book, ch);
      if (existingPath) {
        const absPath = join(process.cwd(), existingPath);
        try {
          const pdfBuffer = readFileSync(absPath);
          log(`  Ch ${ch}: PDF exists (${(pdfBuffer.length / 1024).toFixed(0)} KB) → ${existingPath} — skipping download`);
          result.skipped++;
          if (!options.downloadOnly) {
            try {
              await parseAndStoreChapter(
                pdfBuffer,
                book,
                ch,
                boardId,
                pdfUrl,
                existingPath,
                options,
                log
              );
              result.parsed++;
            } catch (err) {
              const errMsg = `${book.code} ch${ch}: parse failed — ${err instanceof Error ? err.message : String(err)}`;
              log(`    Parse error: ${errMsg}`);
              result.errors.push(errMsg);
            }
          }
        } catch (err) {
          log(`  Ch ${ch}: failed to read existing PDF — ${err instanceof Error ? err.message : String(err)}`);
          result.failed++;
          result.errors.push(`${book.code} ch${ch}: read existing PDF failed`);
        }
        continue;
      }
    }

    // Rate limit
    const now = Date.now();
    const elapsed = now - lastRequestTime;
    if (elapsed < RATE_LIMIT_MS) {
      await sleep(RATE_LIMIT_MS - elapsed);
    }
    lastRequestTime = Date.now();

    log(`  Ch ${ch}/${maxChapters}: ${pdfUrl}`);

    const downloadResult = await downloadWithRetry(pdfUrl);

    if (!downloadResult) {
      result.failed++;
      result.errors.push(`${book.code} ch${ch}: download failed`);
      continue;
    }

    // Save locally
    const savedPath = savePdf(book, ch, downloadResult);
    result.downloaded++;
    result.bytes += downloadResult.length;
    log(`    Saved (${(downloadResult.length / 1024).toFixed(0)} KB) → ${savedPath}`);

    // AI parsing (unless download-only mode)
    if (!options.downloadOnly) {
      try {
        await parseAndStoreChapter(
          downloadResult,
          book,
          ch,
          boardId,
          pdfUrl,
          savedPath,
          options,
          log
        );
        result.parsed++;
      } catch (err) {
        const errMsg = `${book.code} ch${ch}: parse failed — ${err instanceof Error ? err.message : String(err)}`;
        log(`    Parse error: ${errMsg}`);
        result.errors.push(errMsg);
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// AI parsing for a single chapter
// ---------------------------------------------------------------------------

async function parseAndStoreChapter(
  pdfBuffer: Buffer,
  book: NcertBook,
  chapterNum: number,
  boardId: number,
  pdfUrl: string,
  pdfPath: string,
  options: NcertDownloadOptions,
  log: (msg: string) => void
): Promise<void> {
  // Extract text
  let text: string;
  try {
    text = await extractTextFromPdf(pdfBuffer);
  } catch (err) {
    throw new Error(`Text extraction failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (text.trim().length < 50) {
    log(`    Skipping parse — text too short (${text.length} chars, likely image-only)`);
    return;
  }

  // Find/create DB hierarchy: standard → subject → chapter → topic
  const standard = await findOrCreateStandard(boardId, book.grade);
  if (!standard) return;

  const subject = await findOrCreateSubject(standard.id, book.subjectCode, book.subject);
  const chapter = await findOrCreateChapter(subject.id, chapterNum, book, text);
  const topic = await findOrCreateTopic(chapter.id, chapterNum);

  // Check dedup — don't re-insert if this source_url already exists
  const [existing] = await db
    .select({ id: contentItems.id })
    .from(contentItems)
    .where(eq(contentItems.sourceUrl, pdfUrl))
    .limit(1);

  if (existing) {
    log(`    Content already exists for ${pdfUrl}, skipping insert`);
    return;
  }

  // AI Parsing — two strategies:
  // 1. PDF Vision (Gemini): Sends the actual PDF binary, captures diagrams/images/formatting
  // 2. Text-based (Claude/Gemini): Sends extracted text, cheaper but loses images
  //
  // Strategy: Try PDF Vision first for richer content, fall back to text-based

  const visionSystemPrompt = `You are an expert NCERT textbook content extractor. Extract COMPREHENSIVE study notes from this PDF chapter in Markdown format.

Requirements:
- Use proper Markdown: H1 for chapter title, H2 for sections, H3 for subsections
- Preserve ALL mathematical formulas using LaTeX notation ($...$ for inline, $$...$$ for block)
- Include ALL definitions with bold key terms: **Term**: definition
- Include ALL examples with step-by-step solutions
- Describe ALL diagrams, figures, and illustrations: [Figure: description of what the diagram shows]
- Include ALL tables formatted as Markdown tables
- Add a "## Key Points" or "## Summary" section at the end
- Preserve the exact structure and ordering of the textbook
- Include "## Important Formulas" section if applicable
- Language: ${book.language === "hi" ? "Hindi — preserve all Hindi terms" : "English"}
- Target: Class ${book.grade} students studying for board exams`;

  const visionUserPrompt = `Extract complete structured study notes from this NCERT textbook chapter PDF.

Book: ${book.name}
Class: ${book.grade}
Subject: ${book.subject}
Chapter: ${chapterNum}

Extract everything: text, formulas, diagrams (describe them), tables, examples, exercises.
Output in comprehensive Markdown format.`;

  let aiContent: string | null = null;
  let modelUsed = "";
  let tokenCount = 0;
  let costUsd = 0;
  let usedVision = false;

  // Strategy 1: Try PDF Vision (sends actual PDF to Gemini for visual understanding)
  // Only if PDF is small enough (<10MB) and we have Gemini available
  if (pdfBuffer.length < 10 * 1024 * 1024) {
    try {
      log(`    Trying PDF Vision (Gemini)...`);
      const pdfBase64 = pdfBuffer.toString("base64");
      const visionResult = await aiPdfVision(
        visionUserPrompt,
        pdfBase64,
        {
          model: AI_MODELS.GEMINI_FLASH,
          systemPrompt: visionSystemPrompt,
          temperature: 0.1,
          maxTokens: 16384,
          language: book.language,
        }
      );
      aiContent = visionResult.content;
      modelUsed = visionResult.model;
      tokenCount = visionResult.inputTokens + visionResult.outputTokens;
      costUsd = visionResult.costUsd;
      usedVision = true;
      log(`    PDF Vision OK (${modelUsed}): ${visionResult.inputTokens}in/${visionResult.outputTokens}out ($${costUsd.toFixed(4)})`);
    } catch (err) {
      log(`    PDF Vision failed: ${err instanceof Error ? err.message : String(err)}, falling back to text-based...`);
    }
  }

  // Strategy 2: Fall back to text-based parsing if Vision fails or unavailable
  if (!aiContent) {
    const textSystemPrompt = `You are a curriculum content extractor. Given the text from an NCERT textbook chapter, produce comprehensive study notes in Markdown format. Include: chapter title (H1), sections (H2), key concepts, definitions (bold terms), formulas (LaTeX), examples with solutions, summary/key points section. Preserve all technical terms. Language: ${book.language === "hi" ? "Hindi" : "English"}.`;

    const textUserPrompt = `Extract comprehensive study notes from this NCERT textbook chapter.\n\nBook: ${book.name}\nClass: ${book.grade}\nSubject: ${book.subject}\nChapter: ${chapterNum}\n\nText:\n${text.slice(0, 30000)}`;

    const models = resolveModelWithFallbacks(options.aiProvider);
    for (const model of models) {
      try {
        const aiResult = await aiChat(textUserPrompt, {
          model,
          systemPrompt: textSystemPrompt,
          temperature: 0.2,
          maxTokens: 8192,
          language: book.language,
        });
        aiContent = aiResult.content;
        modelUsed = aiResult.model;
        tokenCount = aiResult.inputTokens + aiResult.outputTokens;
        costUsd = aiResult.costUsd;
        log(`    Text-based AI parsed (${modelUsed}): ${aiResult.inputTokens}in/${aiResult.outputTokens}out ($${costUsd.toFixed(4)})`);
        break;
      } catch (err) {
        if (model === models[models.length - 1]) throw err;
        log(`    AI failed with ${model}, trying next...`);
        if (isAuthError(err) || isQuotaError(err)) continue;
        throw err;
      }
    }
  }

  if (!aiContent) throw new Error("All AI models failed");

  // Compute quality score based on actual content analysis
  const qualityScore = computeQualityScore(aiContent, text.length);
  log(`    Quality score: ${(qualityScore * 100).toFixed(0)}%`);

  // Auto-approve + publish high-quality rows so student content is visible
  // without a manual review step. Matches the behaviour of
  // scripts/regenerate-cleared-content.ts, which does the same thing on
  // regeneration. Anything below the 0.7 bar lands as 'pending' for an
  // admin to look at in the review queue.
  const autoApprove = qualityScore >= 0.7;

  // Insert content item
  await db.insert(contentItems).values({
    topicId: topic.id,
    contentType: "note",
    title: `${book.name} — Chapter ${chapterNum}`,
    body: aiContent,
    bodyFormat: "markdown",
    sourceType: "ncert",
    sourceUrl: pdfUrl,
    language: book.language,
    qualityScore: qualityScore.toFixed(2),
    reviewStatus: autoApprove ? "auto_approved" : "pending",
    isPublished: autoApprove,
    metadata: {
      scrapeJobId: options.jobId ?? null,
      ncertBookCode: book.code,
      ncertChapter: chapterNum,
      nepName: book.nepName ?? null,
      pdfPath,
      aiModel: modelUsed,
      aiTokens: tokenCount,
      aiCostUsd: costUsd,
      extractedTextLength: text.length,
      usedPdfVision: usedVision,
      importedAt: new Date().toISOString(),
    },
  });

  // Log to pipeline
  await logPipeline("ncert_chapter_parse", options.jobId ?? 0, "completed", {
    bookCode: book.code,
    chapter: chapterNum,
    grade: book.grade,
    subject: book.subject,
    language: book.language,
    model: modelUsed,
    tokens: tokenCount,
    costUsd,
  }, undefined, modelUsed, tokenCount);
}

// ---------------------------------------------------------------------------
// PDF download with retry
// ---------------------------------------------------------------------------

async function downloadWithRetry(url: string): Promise<Buffer | null> {
  let lastError = "";

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      const response = await globalThis.fetch(url, {
        headers: { "User-Agent": USER_AGENT },
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        lastError = `HTTP ${response.status}`;
        if (response.status === 429 || response.status >= 500) {
          await sleep(RETRY_BASE_DELAY_MS * Math.pow(2, attempt));
          continue;
        }
        return null; // 4xx client error — don't retry
      }

      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_BASE_DELAY_MS * Math.pow(2, attempt));
      }
    }
  }

  console.error(`[NCERT Download] Failed after ${MAX_RETRIES + 1} attempts: ${lastError}`);
  return null;
}

// ---------------------------------------------------------------------------
// Local file storage (→ S3 ncert-pdfs/ in production)
// ---------------------------------------------------------------------------

/**
 * Canonical on-disk path for a given NCERT chapter PDF.
 *
 * Newer scheme (preferred): nests by book code so Part I / Part II books
 * sharing the same subject slug (e.g. keph1 + keph2 both under "physics")
 * do not collide on `chXX.pdf`.
 *
 *   data/ncert-pdfs/{grade}/{subjectSlug}{langSuffix}/{bookCode}/chXX.pdf
 *
 * Legacy scheme (back-compat): single-part books downloaded before this
 * change live at the flat path:
 *
 *   data/ncert-pdfs/{grade}/{subjectSlug}{langSuffix}/chXX.pdf
 *
 * Callers that need to check "does the PDF already exist on disk" should
 * prefer getLocalPath (the new path) but fall back to getLegacyLocalPath.
 */
function getLocalPath(book: NcertBook, chapter: number): string {
  const subjectSlug = getCanonicalSubjectSlug(book.code);
  const langSuffix = book.language === "hi" ? "_hi" : "";
  return `data/ncert-pdfs/${book.grade}/${subjectSlug}${langSuffix}/${book.code}/ch${chapter.toString().padStart(2, "0")}.pdf`;
}

function getLegacyLocalPath(book: NcertBook, chapter: number): string {
  const subjectSlug = getCanonicalSubjectSlug(book.code);
  const langSuffix = book.language === "hi" ? "_hi" : "";
  return `data/ncert-pdfs/${book.grade}/${subjectSlug}${langSuffix}/ch${chapter.toString().padStart(2, "0")}.pdf`;
}

/**
 * Resolve the existing on-disk path for a chapter, preferring the new
 * book-code-nested layout and falling back to the legacy flat layout.
 * Returns null if neither exists.
 */
function resolveExistingLocalPath(book: NcertBook, chapter: number): string | null {
  const primary = getLocalPath(book, chapter);
  if (existsSync(join(process.cwd(), primary))) return primary;
  const legacy = getLegacyLocalPath(book, chapter);
  if (existsSync(join(process.cwd(), legacy))) return legacy;
  return null;
}

function savePdf(book: NcertBook, chapter: number, buffer: Buffer): string {
  const relativePath = getLocalPath(book, chapter);
  const fullPath = join(process.cwd(), relativePath);
  const dir = join(fullPath, "..");

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(fullPath, buffer);
  return relativePath;
}

// ---------------------------------------------------------------------------
// Catalog filtering
// ---------------------------------------------------------------------------

export function filterCatalog(options: NcertDownloadOptions): NcertBook[] {
  let books = [...NCERT_BOOK_CATALOG];

  if (options.grades && options.grades.length > 0) {
    books = books.filter((b) => options.grades!.includes(b.grade));
  }

  // `bookCodes` is an exact-match filter and takes precedence over `subjects`
  // for matching. Callers that already iterate book-by-book should pass this
  // so multi-part subjects don't both slip through a shared `subjects` match.
  if (options.bookCodes && options.bookCodes.length > 0) {
    const codeSet = new Set(options.bookCodes);
    books = books.filter((b) => codeSet.has(b.code));
  } else if (options.subjects && options.subjects.length > 0) {
    const subjectLower = options.subjects.map((s) => s.toLowerCase());
    books = books.filter((b) =>
      subjectLower.some(
        (s) =>
          b.subject.toLowerCase().includes(s) ||
          b.subjectCode.toLowerCase().includes(s) ||
          b.name.toLowerCase().includes(s)
      )
    );
  }

  if (options.languages && options.languages.length > 0) {
    books = books.filter((b) => options.languages!.includes(b.language as "en" | "hi"));
  }

  return books;
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

async function findOrCreateStandard(boardId: number, grade: number): Promise<{ id: number } | null> {
  const academicYear = "2025-26";
  const [existing] = await db
    .select({ id: standards.id })
    .from(standards)
    .where(and(eq(standards.boardId, boardId), eq(standards.grade, grade), eq(standards.academicYear, academicYear)))
    .limit(1);
  if (existing) return existing;

  try {
    const [created] = await db
      .insert(standards)
      .values({ boardId, grade, academicYear, isActive: true, metadata: { source: "ncert_download" } })
      .returning({ id: standards.id });
    return created ?? null;
  } catch {
    const [refetched] = await db
      .select({ id: standards.id })
      .from(standards)
      .where(and(eq(standards.boardId, boardId), eq(standards.grade, grade), eq(standards.academicYear, academicYear)))
      .limit(1);
    return refetched ?? null;
  }
}

async function findOrCreateSubject(standardId: number, code: string, name: string): Promise<{ id: number }> {
  // First try exact code match
  const [byCode] = await db
    .select({ id: subjects.id })
    .from(subjects)
    .where(and(eq(subjects.standardId, standardId), eq(subjects.code, code)))
    .limit(1);
  if (byCode) return byCode;

  // Then try name match (case-insensitive) — avoids creating "MATHS" when "MATH" exists
  const [byName] = await db
    .select({ id: subjects.id })
    .from(subjects)
    .where(and(eq(subjects.standardId, standardId), sql`lower(${subjects.name}) = lower(${name})`))
    .limit(1);
  if (byName) return byName;

  // Create new only if no match by code or name
  const [created] = await db
    .insert(subjects)
    .values({ standardId, code, name, subjectType: "theory", isElective: false, metadata: { source: "ncert" } })
    .returning({ id: subjects.id });
  return created;
}

async function findOrCreateChapter(
  subjectId: number,
  chapterNum: number,
  book: NcertBook,
  _text: string
): Promise<{ id: number }> {
  const [existing] = await db
    .select({ id: chapters.id })
    .from(chapters)
    .where(and(eq(chapters.subjectId, subjectId), eq(chapters.chapterNumber, chapterNum)))
    .limit(1);
  if (existing) return existing;

  const [created] = await db
    .insert(chapters)
    .values({
      subjectId,
      chapterNumber: chapterNum,
      title: `${book.name} — Chapter ${chapterNum}`,
      sortOrder: chapterNum,
      metadata: { source: "ncert", bookCode: book.code, nepName: book.nepName ?? null },
    })
    .returning({ id: chapters.id });
  return created;
}

async function findOrCreateTopic(chapterId: number, chapterNum: number): Promise<{ id: number }> {
  const [existing] = await db
    .select({ id: topics.id })
    .from(topics)
    .where(eq(topics.chapterId, chapterId))
    .limit(1);
  if (existing) return existing;

  const [created] = await db
    .insert(topics)
    .values({
      chapterId,
      title: `Chapter ${chapterNum} Content`,
      sortOrder: 1,
      metadata: { source: "ncert" },
    })
    .returning({ id: topics.id });
  return created;
}

// ---------------------------------------------------------------------------
// Job helpers
// ---------------------------------------------------------------------------

async function updateJob(
  jobId: number,
  updates: Partial<{ status: string; itemsFound: number; itemsProcessed: number; errorLog: string }>
): Promise<void> {
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
      pipelineStage: stage,
      entityType: "scrape_job",
      entityId,
      status,
      outputData: data,
      processingTimeMs: processingTimeMs ?? null,
      aiModelUsed: aiModelUsed ?? null,
      aiTokensUsed: aiTokensUsed ?? null,
    });
  } catch { /* non-critical */ }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
