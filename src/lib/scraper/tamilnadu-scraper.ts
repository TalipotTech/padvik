/**
 * Tamil Nadu DGE Textbook PDF Downloader
 *
 * Source: textbooksonline.tn.nic.in (TN Govt Textbook Corporation)
 * Downloads textbook PDFs for Classes 1-12 in English and Tamil medium.
 *
 * Language routing: language='ta' → Gemini (via provider), language='en' → Claude
 * Board: TN_DGE
 *
 * Storage: data/tamilnadu/{class}/{medium}/{subject}.pdf
 */
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import { boards, standards, subjects, chapters, topics } from "@/db/schema/curriculum";
import { contentItems } from "@/db/schema/content";
import { scrapeJobs, contentPipelineLogs } from "@/db/schema/system";
import { BaseScraper } from "./base-scraper";
import { extractTextFromPdf, extractLinks, resolveUrl } from "./parser";
import { aiChat, isAuthError, isQuotaError } from "../ai/provider";
import { computeQualityScore } from "../ai/quality-scorer";
import { resolveModelWithFallbacks } from "./ai-model-resolver";
import type { AIProviderChoice } from "../queue";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BOARD_CODE = "TN_DGE";
const TN_BASE = "https://textbooksonline.tn.nic.in";
/** TN textbook corp indexes by class number in the URL */
const TN_CLASS_PAGES: Record<number, string> = {};
for (let i = 1; i <= 12; i++) {
  TN_CLASS_PAGES[i] = `${TN_BASE}/Books/Std${i.toString().padStart(2, "0")}`;
}

const PDF_LINK_PATTERN = /\.pdf$/i;
const DATA_DIR = join(process.cwd(), "data", "tamilnadu");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TamilNaduScrapeOptions {
  grades?: number[];
  medium?: "english" | "tamil" | "both";
  subjectFilter?: string;
  jobId?: number;
  maxPdfs?: number;
  aiProvider?: AIProviderChoice;
  downloadOnly?: boolean;
}

export interface TamilNaduScrapeResult {
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

export class TamilNaduScraper extends BaseScraper {
  name = "Tamil Nadu DGE Scraper";
  boardCode = BOARD_CODE;

  async scrape(options?: TamilNaduScrapeOptions): Promise<number> {
    const result = await this.scrapeWithDetails(options);
    return result.downloaded;
  }

  async scrapeWithDetails(options?: TamilNaduScrapeOptions): Promise<TamilNaduScrapeResult> {
    const result: TamilNaduScrapeResult = {
      pdfLinks: 0, downloaded: 0, parsed: 0, failed: 0, skipped: 0, errors: [],
    };
    const jobId = options?.jobId;

    try {
      const [board] = await db.select().from(boards).where(eq(boards.code, BOARD_CODE)).limit(1);
      if (!board) throw new Error(`Board '${BOARD_CODE}' not found. Run seed first.`);

      this.log(`Starting Tamil Nadu textbook scrape (board id: ${board.id})`);
      if (jobId) await this.updateJob(jobId, { status: "running" });

      const gradesToFetch = options?.grades ?? Array.from({ length: 12 }, (_, i) => i + 1);
      const allLinks: Array<{ url: string; grade: number; medium: string }> = [];

      for (const grade of gradesToFetch) {
        const pageUrl = TN_CLASS_PAGES[grade];
        if (!pageUrl) continue;

        this.log(`Fetching Class ${grade} page...`);
        const pageResult = await this.fetchText(pageUrl);
        if (!pageResult.success || !pageResult.data) {
          // Try index.html variant
          const altResult = await this.fetchText(`${pageUrl}/index.html`);
          if (!altResult.success || !altResult.data) {
            this.log(`  Failed to fetch Class ${grade}`);
            continue;
          }
          pageResult.data = altResult.data;
        }

        const links = extractLinks(pageResult.data!, PDF_LINK_PATTERN)
          .map((link) => resolveUrl(pageUrl, link));

        for (const url of links) {
          const medium = detectMedium(url);
          if (options?.medium && options.medium !== "both" && medium !== options.medium) continue;
          if (options?.subjectFilter && !url.toLowerCase().includes(options.subjectFilter.toLowerCase())) continue;
          allLinks.push({ url, grade, medium });
        }
      }

      const seen = new Set<string>();
      const unique = allLinks.filter((l) => { if (seen.has(l.url)) return false; seen.add(l.url); return true; });
      result.pdfLinks = unique.length;
      this.log(`Found ${unique.length} unique PDF links`);

      const toProcess = options?.maxPdfs ? unique.slice(0, options.maxPdfs) : unique;
      if (jobId) await this.updateJob(jobId, { itemsFound: toProcess.length });

      for (let i = 0; i < toProcess.length; i++) {
        const { url, grade, medium } = toProcess[i];
        const language = medium === "tamil" ? "ta" : "en";
        this.log(`\n[${i + 1}/${toProcess.length}] Class ${grade} (${medium}): ${url}`);

        try {
          const success = await this.processPdf(url, board.id, grade, language, medium, options);
          if (success === "parsed") { result.downloaded++; result.parsed++; }
          else if (success === "downloaded") result.downloaded++;
          else if (success === "skipped") result.skipped++;
          else result.failed++;
        } catch (err) {
          result.failed++;
          result.errors.push(`${url}: ${err instanceof Error ? err.message : String(err)}`);
          this.logError(`Failed: ${url}`, err);
        }

        if (jobId) await this.updateJob(jobId, { itemsProcessed: i + 1 });
      }

      this.log(`\n=== Summary: ${result.downloaded} downloaded, ${result.parsed} parsed, ${result.failed} failed ===`);
      if (jobId) { await this.updateJob(jobId, { status: "completed" }); await this.updateJobMetadata(jobId, { scrapeResult: result }); }
      return result;
    } catch (err) {
      this.logError("Scrape failed", err);
      if (jobId) await this.updateJob(jobId, { status: "failed", errorLog: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }

  private async processPdf(
    url: string, boardId: number, grade: number, language: string, medium: string, options?: TamilNaduScrapeOptions
  ): Promise<"parsed" | "downloaded" | "skipped" | "failed"> {
    const [existing] = await db.select({ id: contentItems.id }).from(contentItems).where(eq(contentItems.sourceUrl, url)).limit(1);
    if (existing) { this.log(`  Already in DB, skipping`); return "skipped"; }

    const pdfResult = await this.fetchPdf(url);
    if (!pdfResult.success || !pdfResult.data) return "failed";

    const filename = url.split("/").pop() ?? `tn_textbook_${Date.now()}.pdf`;
    const localPath = saveLocally(grade, medium, filename, pdfResult.data);
    this.log(`  Saved (${(pdfResult.data.length / 1024).toFixed(0)} KB)`);

    if (options?.downloadOnly) return "downloaded";

    let text: string;
    try { text = await extractTextFromPdf(pdfResult.data); } catch { return "downloaded"; }
    if (text.trim().length < 50) return "downloaded";

    const standard = await findOrCreateStandard(boardId, grade);
    if (!standard) return "failed";
    const subjectName = inferSubject(filename);
    const subjectCode = subjectName.toUpperCase().replace(/[^A-Z0-9]/g, "_").slice(0, 50);
    const subject = await findOrCreateSubject(standard.id, subjectCode, subjectName);
    const chapter = await findOrCreateChapter(subject.id, 1, filename);
    const topic = await findOrCreateTopic(chapter.id, subjectName);

    const models = resolveModelWithFallbacks(options?.aiProvider);
    const systemPrompt = language === "ta"
      ? `நீங்கள் பாடத்திட்ட உள்ளடக்க பிரிப்பாளர். தமிழ்நாடு DGE பாடநூலிலிருந்து Markdown வடிவில் கட்டமைக்கப்பட்ட படிப்புக் குறிப்புகளைப் பிரித்தெடுக்கவும். Include: title, key concepts as H2, definitions, formulas. Preserve Tamil terms. Output in Tamil.`
      : `You are a curriculum content extractor. Given text from a Tamil Nadu DGE textbook, produce structured study notes in Markdown.`;

    let aiContent: string | null = null;
    let modelUsed = "";
    for (const model of models) {
      try {
        const r = await aiChat(
          `Extract study notes.\nClass: ${grade}\nSubject: ${subjectName}\nMedium: ${medium}\n\nText:\n${text.slice(0, 30000)}`,
          { model, systemPrompt, temperature: 0.2, maxTokens: 8192, language }
        );
        aiContent = r.content; modelUsed = r.model;
        this.log(`  AI parsed (${modelUsed}): $${r.costUsd.toFixed(4)}`);
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
      title: `${subjectName} (Tamil Nadu, Class ${grade}, ${medium})`,
      body: aiContent, bodyFormat: "markdown", sourceType: "tamilnadu_dge",
      sourceUrl: url, language, qualityScore: computeQualityScore(aiContent ?? "").toFixed(2), reviewStatus: "pending",
      isPublished: false, metadata: { board: BOARD_CODE, grade, medium, pdfPath: localPath, aiModel: modelUsed, importedAt: new Date().toISOString() },
    });
    return "parsed";
  }
}

// Helpers
function detectMedium(url: string): "english" | "tamil" {
  const l = url.toLowerCase();
  if (l.includes("tamil") || l.includes("_tm") || l.includes("_ta")) return "tamil";
  return "english";
}
function inferSubject(filename: string): string {
  const l = filename.toLowerCase();
  if (l.includes("math")) return "Mathematics";
  if (l.includes("science")) return "Science";
  if (l.includes("social")) return "Social Science";
  if (l.includes("english")) return "English";
  if (l.includes("tamil")) return "Tamil";
  if (l.includes("physics")) return "Physics";
  if (l.includes("chemistry")) return "Chemistry";
  if (l.includes("biology")) return "Biology";
  return filename.replace(/\.pdf$/i, "").replace(/[_-]/g, " ");
}
function saveLocally(grade: number, medium: string, filename: string, buffer: Buffer): string {
  const dir = join(DATA_DIR, String(grade), medium);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const s = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  writeFileSync(join(dir, s), buffer);
  return `data/tamilnadu/${grade}/${medium}/${s}`;
}
async function findOrCreateStandard(boardId: number, grade: number) {
  const ay = "2025-26";
  const [e] = await db.select({ id: standards.id }).from(standards).where(and(eq(standards.boardId, boardId), eq(standards.grade, grade), eq(standards.academicYear, ay))).limit(1);
  if (e) return e;
  try { const [c] = await db.insert(standards).values({ boardId, grade, academicYear: ay, isActive: true, metadata: { source: "tamilnadu_dge" } }).returning({ id: standards.id }); return c ?? null; }
  catch { const [r] = await db.select({ id: standards.id }).from(standards).where(and(eq(standards.boardId, boardId), eq(standards.grade, grade), eq(standards.academicYear, ay))).limit(1); return r ?? null; }
}
async function findOrCreateSubject(sid: number, code: string, name: string) {
  const [e] = await db.select({ id: subjects.id }).from(subjects).where(and(eq(subjects.standardId, sid), eq(subjects.code, code))).limit(1);
  if (e) return e;
  const [c] = await db.insert(subjects).values({ standardId: sid, code, name, subjectType: "theory", isElective: false, metadata: { source: "tamilnadu_dge" } }).returning({ id: subjects.id });
  return c;
}
async function findOrCreateChapter(sid: number, n: number, title: string) {
  const [e] = await db.select({ id: chapters.id }).from(chapters).where(and(eq(chapters.subjectId, sid), eq(chapters.chapterNumber, n))).limit(1);
  if (e) return e;
  const [c] = await db.insert(chapters).values({ subjectId: sid, chapterNumber: n, title, sortOrder: n, metadata: { source: "tamilnadu_dge" } }).returning({ id: chapters.id });
  return c;
}
async function findOrCreateTopic(cid: number, title: string) {
  const [e] = await db.select({ id: topics.id }).from(topics).where(eq(topics.chapterId, cid)).limit(1);
  if (e) return e;
  const [c] = await db.insert(topics).values({ chapterId: cid, title, sortOrder: 1, metadata: { source: "tamilnadu_dge" } }).returning({ id: topics.id });
  return c;
}
