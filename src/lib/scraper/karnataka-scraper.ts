/**
 * Karnataka State Board (KSEAB / KTBS) Textbook PDF Downloader
 *
 * Source: ktbs.kar.nic.in (Karnataka Textbook Society)
 * Downloads textbook PDFs for Classes 1-10 (primary/secondary) in
 * English and Kannada medium, then queues for AI parsing.
 *
 * Language routing: language='kn' → Gemini (via provider), language='en' → Claude
 * Board: KA_KSEAB
 *
 * Storage: data/karnataka/{class}/{medium}/{subject}.pdf
 */
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import { boards, standards, subjects, chapters, topics } from "@/db/schema/curriculum";
import { contentItems } from "@/db/schema/content";
import { scrapeJobs, contentPipelineLogs } from "@/db/schema/system";
import { BaseScraper, type ScrapeResult } from "./base-scraper";
import { extractTextFromPdf, extractLinks, resolveUrl } from "./parser";
import { aiChat, isAuthError, isQuotaError } from "../ai/provider";
import { computeQualityScore } from "../ai/quality-scorer";
import { resolveModelWithFallbacks } from "./ai-model-resolver";
import type { AIProviderChoice } from "../queue";
import { DEFAULT_ACADEMIC_YEAR } from "../academic-year";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BOARD_CODE = "KA_KSEAB";
const KTBS_BASE = "https://ktbs.kar.nic.in";
const KTBS_TEXTBOOK_PAGES = [
  `${KTBS_BASE}/new/website_textbooks/class1.html`,
  `${KTBS_BASE}/new/website_textbooks/class2.html`,
  `${KTBS_BASE}/new/website_textbooks/class3.html`,
  `${KTBS_BASE}/new/website_textbooks/class4.html`,
  `${KTBS_BASE}/new/website_textbooks/class5.html`,
  `${KTBS_BASE}/new/website_textbooks/class6.html`,
  `${KTBS_BASE}/new/website_textbooks/class7.html`,
  `${KTBS_BASE}/new/website_textbooks/class8.html`,
  `${KTBS_BASE}/new/website_textbooks/class9.html`,
  `${KTBS_BASE}/new/website_textbooks/class10.html`,
];

const PDF_LINK_PATTERN = /\.pdf$/i;
const DATA_DIR = join(process.cwd(), "data", "karnataka");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface KarnatakaScrapeOptions {
  grades?: number[];
  medium?: "english" | "kannada" | "both";
  subjectFilter?: string;
  jobId?: number;
  maxPdfs?: number;
  aiProvider?: AIProviderChoice;
  downloadOnly?: boolean;
}

export interface KarnatakaScrapeResult {
  pdfLinks: number;
  downloaded: number;
  parsed: number;
  failed: number;
  skipped: number;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Scraper
// ---------------------------------------------------------------------------

export class KarnatakaScraper extends BaseScraper {
  name = "Karnataka KTBS Scraper";
  boardCode = BOARD_CODE;

  async scrape(options?: KarnatakaScrapeOptions): Promise<number> {
    const result = await this.scrapeWithDetails(options);
    return result.downloaded;
  }

  async scrapeWithDetails(options?: KarnatakaScrapeOptions): Promise<KarnatakaScrapeResult> {
    const result: KarnatakaScrapeResult = {
      pdfLinks: 0, downloaded: 0, parsed: 0, failed: 0, skipped: 0, errors: [],
    };

    const jobId = options?.jobId;

    try {
      const [board] = await db.select().from(boards).where(eq(boards.code, BOARD_CODE)).limit(1);
      if (!board) throw new Error(`Board '${BOARD_CODE}' not found. Run seed first.`);

      this.log(`Starting Karnataka textbook scrape (board id: ${board.id})`);
      if (jobId) await this.updateJob(jobId, { status: "running" });

      // Determine which class pages to fetch
      const gradesToFetch = options?.grades ?? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const pages = KTBS_TEXTBOOK_PAGES.filter((_, i) => gradesToFetch.includes(i + 1));

      // Collect PDF links from each class page
      const allLinks: Array<{ url: string; grade: number; medium: string }> = [];

      for (let i = 0; i < pages.length; i++) {
        const grade = gradesToFetch[i] ?? i + 1;
        this.log(`Fetching Class ${grade} page...`);
        const pageResult = await this.fetchText(pages[i]);

        if (!pageResult.success || !pageResult.data) {
          this.log(`  Failed: ${pageResult.error}`);
          continue;
        }

        const links = extractLinks(pageResult.data, PDF_LINK_PATTERN)
          .map((link) => resolveUrl(KTBS_BASE, link));

        for (const url of links) {
          const medium = detectMediumFromUrl(url);
          if (options?.medium && options.medium !== "both" && medium !== options.medium) continue;
          if (options?.subjectFilter && !url.toLowerCase().includes(options.subjectFilter.toLowerCase())) continue;
          allLinks.push({ url, grade, medium });
        }
      }

      // Deduplicate
      const seen = new Set<string>();
      const unique = allLinks.filter((l) => { if (seen.has(l.url)) return false; seen.add(l.url); return true; });
      result.pdfLinks = unique.length;
      this.log(`Found ${unique.length} unique PDF links`);

      const toProcess = options?.maxPdfs ? unique.slice(0, options.maxPdfs) : unique;
      if (jobId) await this.updateJob(jobId, { itemsFound: toProcess.length });

      // Process each PDF
      for (let i = 0; i < toProcess.length; i++) {
        const { url, grade, medium } = toProcess[i];
        const language = medium === "kannada" ? "kn" : "en";
        this.log(`\n[${i + 1}/${toProcess.length}] Class ${grade} (${medium}): ${url}`);

        try {
          const success = await this.processTextbookPdf(
            url, board.id, grade, language, medium, options
          );
          if (success === "parsed") { result.downloaded++; result.parsed++; }
          else if (success === "downloaded") result.downloaded++;
          else if (success === "skipped") result.skipped++;
          else result.failed++;
        } catch (err) {
          result.failed++;
          const errMsg = `${url}: ${err instanceof Error ? err.message : String(err)}`;
          result.errors.push(errMsg);
          this.logError(errMsg);
        }

        if (jobId) await this.updateJob(jobId, { itemsProcessed: i + 1 });
      }

      this.log(`\n=== Summary: ${result.downloaded} downloaded, ${result.parsed} parsed, ${result.failed} failed ===`);
      if (jobId) {
        await this.updateJob(jobId, { status: "completed" });
        await this.updateJobMetadata(jobId, { scrapeResult: result });
      }

      return result;
    } catch (err) {
      this.logError("Scrape failed", err);
      if (jobId) await this.updateJob(jobId, { status: "failed", errorLog: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }

  private async processTextbookPdf(
    url: string,
    boardId: number,
    grade: number,
    language: string,
    medium: string,
    options?: KarnatakaScrapeOptions
  ): Promise<"parsed" | "downloaded" | "skipped" | "failed"> {
    // Dedup
    const [existing] = await db.select({ id: contentItems.id }).from(contentItems)
      .where(eq(contentItems.sourceUrl, url)).limit(1);
    if (existing) { this.log(`  Already in DB, skipping`); return "skipped"; }

    // Download
    const pdfResult = await this.fetchPdf(url);
    if (!pdfResult.success || !pdfResult.data) {
      this.log(`  Download failed: ${pdfResult.error}`);
      return "failed";
    }

    // Save locally
    const filename = url.split("/").pop() ?? `textbook_${Date.now()}.pdf`;
    const localPath = saveLocally(grade, medium, filename, pdfResult.data);
    this.log(`  Saved (${(pdfResult.data.length / 1024).toFixed(0)} KB) → ${localPath}`);

    if (options?.downloadOnly) return "downloaded";

    // Extract text
    let text: string;
    try { text = await extractTextFromPdf(pdfResult.data); } catch { return "downloaded"; }
    if (text.trim().length < 50) return "downloaded";

    // DB hierarchy
    const standard = await findOrCreateStandard(boardId, grade);
    if (!standard) return "failed";
    const subjectName = inferSubjectFromFilename(filename);
    const subjectCode = subjectName.toUpperCase().replace(/[^A-Z0-9]/g, "_").slice(0, 50);
    const subject = await findOrCreateSubject(standard.id, subjectCode, subjectName);
    const chapter = await findOrCreateChapter(subject.id, 1, filename);
    const topic = await findOrCreateTopic(chapter.id, subjectName);

    // AI parse with language routing
    const models = resolveModelWithFallbacks(options?.aiProvider);
    const systemPrompt = language === "kn"
      ? `ನೀವು ಪಠ್ಯಕ್ರಮ ವಿಷಯ ಹೊರತೆಗೆಯುವವರು. Karnataka KSEAB ಪಠ್ಯಪುಸ್ತಕದಿಂದ ರಚನಾತ್ಮಕ ಅಧ್ಯಯನ ಟಿಪ್ಪಣಿಗಳನ್ನು Markdown ರೂಪದಲ್ಲಿ ಹೊರತೆಗೆಯಿರಿ. Include: title, key concepts as H2, definitions, formulas. Preserve Kannada terms. Output in Kannada.`
      : `You are a curriculum content extractor. Given text from a Karnataka KSEAB textbook, produce structured study notes in Markdown. Include: title, key concepts as H2 headings, definitions, formulas, and important points.`;

    let aiContent: string | null = null;
    let modelUsed = "";
    let costUsd = 0;

    for (const model of models) {
      try {
        const r = await aiChat(
          `Extract study notes from this Karnataka textbook.\nClass: ${grade}\nSubject: ${subjectName}\nMedium: ${medium}\n\nText:\n${text.slice(0, 30000)}`,
          { model, systemPrompt, temperature: 0.2, maxTokens: 8192, language }
        );
        aiContent = r.content; modelUsed = r.model; costUsd = r.costUsd;
        this.log(`  AI parsed (${modelUsed}): $${costUsd.toFixed(4)}`);
        break;
      } catch (err) {
        if (model === models[models.length - 1]) throw err;
        if (isAuthError(err) || isQuotaError(err)) continue;
        throw err;
      }
    }
    if (!aiContent) throw new Error("All AI models failed");

    await db.insert(contentItems).values({
      topicId: topic.id, contentType: "note",
      title: `${subjectName} (Karnataka, Class ${grade}, ${medium})`,
      body: aiContent, bodyFormat: "markdown", sourceType: "karnataka_ktbs",
      sourceUrl: url, language, qualityScore: computeQualityScore(aiContent ?? "").toFixed(2), reviewStatus: "pending",
      isPublished: false, metadata: { board: BOARD_CODE, grade, medium, pdfPath: localPath, aiModel: modelUsed, importedAt: new Date().toISOString() },
    });

    return "parsed";
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function detectMediumFromUrl(url: string): "english" | "kannada" {
  const lower = url.toLowerCase();
  if (lower.includes("kannada") || lower.includes("kan_") || lower.includes("_kan")) return "kannada";
  return "english";
}

function inferSubjectFromFilename(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.includes("math")) return "Mathematics";
  if (lower.includes("science") || lower.includes("vigyan")) return "Science";
  if (lower.includes("social")) return "Social Science";
  if (lower.includes("english")) return "English";
  if (lower.includes("kannada")) return "Kannada";
  if (lower.includes("hindi")) return "Hindi";
  if (lower.includes("physics") || lower.includes("bhautik")) return "Physics";
  if (lower.includes("chemistry") || lower.includes("rasayan")) return "Chemistry";
  if (lower.includes("biology") || lower.includes("jeev")) return "Biology";
  return filename.replace(/\.pdf$/i, "").replace(/[_-]/g, " ");
}

function saveLocally(grade: number, medium: string, filename: string, buffer: Buffer): string {
  const dir = join(DATA_DIR, String(grade), medium);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const sanitized = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  writeFileSync(join(dir, sanitized), buffer);
  return `data/karnataka/${grade}/${medium}/${sanitized}`;
}

async function findOrCreateStandard(boardId: number, grade: number): Promise<{ id: number } | null> {
  const ay = DEFAULT_ACADEMIC_YEAR;
  const [e] = await db.select({ id: standards.id }).from(standards)
    .where(and(eq(standards.boardId, boardId), eq(standards.grade, grade), eq(standards.academicYear, ay))).limit(1);
  if (e) return e;
  try {
    const [c] = await db.insert(standards).values({ boardId, grade, academicYear: ay, isActive: true, metadata: { source: "karnataka_scraper" } }).returning({ id: standards.id });
    return c ?? null;
  } catch {
    const [r] = await db.select({ id: standards.id }).from(standards)
      .where(and(eq(standards.boardId, boardId), eq(standards.grade, grade), eq(standards.academicYear, ay))).limit(1);
    return r ?? null;
  }
}

async function findOrCreateSubject(standardId: number, code: string, name: string): Promise<{ id: number }> {
  const [e] = await db.select({ id: subjects.id }).from(subjects)
    .where(and(eq(subjects.standardId, standardId), eq(subjects.code, code))).limit(1);
  if (e) return e;
  const [c] = await db.insert(subjects).values({ standardId, code, name, subjectType: "theory", isElective: false, metadata: { source: "karnataka_ktbs" } }).returning({ id: subjects.id });
  return c;
}

async function findOrCreateChapter(subjectId: number, chNum: number, title: string): Promise<{ id: number }> {
  const [e] = await db.select({ id: chapters.id }).from(chapters)
    .where(and(eq(chapters.subjectId, subjectId), eq(chapters.chapterNumber, chNum))).limit(1);
  if (e) return e;
  const [c] = await db.insert(chapters).values({ subjectId, chapterNumber: chNum, title, sortOrder: chNum, metadata: { source: "karnataka_ktbs" } }).returning({ id: chapters.id });
  return c;
}

async function findOrCreateTopic(chapterId: number, title: string): Promise<{ id: number }> {
  const [e] = await db.select({ id: topics.id }).from(topics).where(eq(topics.chapterId, chapterId)).limit(1);
  if (e) return e;
  const [c] = await db.insert(topics).values({ chapterId, title, sortOrder: 1, metadata: { source: "karnataka_ktbs" } }).returning({ id: topics.id });
  return c;
}
