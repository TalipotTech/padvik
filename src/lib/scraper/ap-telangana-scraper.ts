/**
 * Andhra Pradesh (BSEAP) + Telangana (BSETS) Textbook PDF Downloader
 *
 * Sources:
 *   AP: scert.ap.gov.in → textbook PDFs
 *   TS: scert.telangana.gov.in → textbook PDFs
 *
 * Both states share Telugu language and similar curriculum structure.
 * Combined in one scraper since the patterns are almost identical.
 *
 * Language routing: language='te' → Gemini (via provider), language='en' → Claude
 * Boards: AP_BSEAP and TS_BSETS
 *
 * Storage: data/ap-telangana/{board}/{class}/{medium}/{subject}.pdf
 */
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import { boards, standards, subjects, chapters, topics } from "@/db/schema/curriculum";
import { contentItems } from "@/db/schema/content";
import { scrapeJobs } from "@/db/schema/system";
import { BaseScraper } from "./base-scraper";
import { extractTextFromPdf, extractLinks, resolveUrl } from "./parser";
import { aiChat, isAuthError, isQuotaError } from "../ai/provider";
import { computeQualityScore } from "../ai/quality-scorer";
import { resolveModelWithFallbacks } from "./ai-model-resolver";
import type { AIProviderChoice } from "../queue";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BOARD_CONFIGS = {
  AP_BSEAP: {
    code: "AP_BSEAP",
    name: "Andhra Pradesh BSEAP",
    base: "https://scert.ap.gov.in",
    textbookPages: [
      "https://scert.ap.gov.in/APSCERT/Textbooks",
      "https://scert.ap.gov.in/APSCERT/Downloads",
    ],
  },
  TS_BSETS: {
    code: "TS_BSETS",
    name: "Telangana BSETS",
    base: "https://scert.telangana.gov.in",
    textbookPages: [
      "https://scert.telangana.gov.in/textbooks",
      "https://scert.telangana.gov.in/downloads",
    ],
  },
} as const;

type APTSBoardCode = keyof typeof BOARD_CONFIGS;

const PDF_LINK_PATTERN = /\.pdf$/i;
const DATA_DIR = join(process.cwd(), "data", "ap-telangana");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface APTScrapeOptions {
  /** Which board to scrape: AP, TS, or both (default: both) */
  board?: "AP_BSEAP" | "TS_BSETS" | "both";
  grades?: number[];
  medium?: "english" | "telugu" | "both";
  subjectFilter?: string;
  jobId?: number;
  maxPdfs?: number;
  aiProvider?: AIProviderChoice;
  downloadOnly?: boolean;
}

export interface APTScrapeResult {
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

export class APTelanganaScraper extends BaseScraper {
  name = "AP/Telangana Scraper";
  boardCode = "AP_TS";

  async scrape(options?: APTScrapeOptions): Promise<number> {
    const result = await this.scrapeWithDetails(options);
    return result.downloaded;
  }

  async scrapeWithDetails(options?: APTScrapeOptions): Promise<APTScrapeResult> {
    const result: APTScrapeResult = {
      pdfLinks: 0, downloaded: 0, parsed: 0, failed: 0, skipped: 0, errors: [],
    };
    const jobId = options?.jobId;
    const boardOpt = options?.board ?? "both";

    try {
      if (jobId) await this.updateJob(jobId, { status: "running" });

      const boardCodes: APTSBoardCode[] = boardOpt === "both"
        ? ["AP_BSEAP", "TS_BSETS"]
        : [boardOpt];

      for (const boardCode of boardCodes) {
        const config = BOARD_CONFIGS[boardCode];
        this.log(`\n=== Scraping ${config.name} ===`);

        const [board] = await db.select().from(boards).where(eq(boards.code, config.code)).limit(1);
        if (!board) {
          this.log(`Board '${config.code}' not found in DB, skipping`);
          continue;
        }

        const links = await this.collectPdfLinks(config, options);
        this.log(`Found ${links.length} PDF links for ${config.name}`);
        result.pdfLinks += links.length;

        const toProcess = options?.maxPdfs
          ? links.slice(0, Math.max(0, options.maxPdfs - result.downloaded))
          : links;

        for (let i = 0; i < toProcess.length; i++) {
          const { url, grade, medium } = toProcess[i];
          const language = medium === "telugu" ? "te" : "en";
          this.log(`[${i + 1}/${toProcess.length}] Class ${grade} (${medium}): ${url}`);

          try {
            const s = await this.processPdf(url, board.id, config.code, grade, language, medium, options);
            if (s === "parsed") { result.downloaded++; result.parsed++; }
            else if (s === "downloaded") result.downloaded++;
            else if (s === "skipped") result.skipped++;
            else result.failed++;
          } catch (err) {
            result.failed++;
            result.errors.push(`${url}: ${err instanceof Error ? err.message : String(err)}`);
          }

          if (jobId) await this.updateJob(jobId, { itemsProcessed: result.downloaded + result.failed + result.skipped });
        }
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

  private async collectPdfLinks(
    config: (typeof BOARD_CONFIGS)[APTSBoardCode],
    options?: APTScrapeOptions
  ): Promise<Array<{ url: string; grade: number; medium: string }>> {
    const links: Array<{ url: string; grade: number; medium: string }> = [];

    for (const pageUrl of config.textbookPages) {
      this.log(`  Fetching: ${pageUrl}`);
      const pageResult = await this.fetchText(pageUrl);
      if (!pageResult.success || !pageResult.data) {
        this.log(`  Failed: ${pageResult.error}`);
        continue;
      }

      const pdfLinks = extractLinks(pageResult.data, PDF_LINK_PATTERN)
        .map((link) => resolveUrl(config.base, link));

      for (const url of pdfLinks) {
        const grade = inferGrade(url);
        if (grade === 0) continue;
        if (options?.grades && !options.grades.includes(grade)) continue;
        const medium = detectMedium(url);
        if (options?.medium && options.medium !== "both" && medium !== options.medium) continue;
        if (options?.subjectFilter && !url.toLowerCase().includes(options.subjectFilter.toLowerCase())) continue;
        links.push({ url, grade, medium });
      }
    }

    // Deduplicate
    const seen = new Set<string>();
    return links.filter((l) => { if (seen.has(l.url)) return false; seen.add(l.url); return true; });
  }

  private async processPdf(
    url: string, boardId: number, boardCode: string, grade: number, language: string, medium: string, options?: APTScrapeOptions
  ): Promise<"parsed" | "downloaded" | "skipped" | "failed"> {
    const [existing] = await db.select({ id: contentItems.id }).from(contentItems).where(eq(contentItems.sourceUrl, url)).limit(1);
    if (existing) return "skipped";

    const pdfResult = await this.fetchPdf(url);
    if (!pdfResult.success || !pdfResult.data) return "failed";

    const filename = url.split("/").pop() ?? `apts_${Date.now()}.pdf`;
    const localPath = saveLocally(boardCode, grade, medium, filename, pdfResult.data);
    this.log(`  Saved (${(pdfResult.data.length / 1024).toFixed(0)} KB)`);

    if (options?.downloadOnly) return "downloaded";

    let text: string;
    try { text = await extractTextFromPdf(pdfResult.data); } catch { return "downloaded"; }
    if (text.trim().length < 50) return "downloaded";

    const standard = await findOrCreateStandard(boardId, grade);
    if (!standard) return "failed";
    const subjectName = inferSubject(filename);
    const code = subjectName.toUpperCase().replace(/[^A-Z0-9]/g, "_").slice(0, 50);
    const subject = await findOrCreateSubject(standard.id, code, subjectName);
    const chapter = await findOrCreateChapter(subject.id, 1, filename);
    const topic = await findOrCreateTopic(chapter.id, subjectName);

    const models = resolveModelWithFallbacks(options?.aiProvider);
    const boardLabel = boardCode === "AP_BSEAP" ? "Andhra Pradesh" : "Telangana";
    const systemPrompt = language === "te"
      ? `మీరు పాఠ్యాంశ విషయ వెలికితీతదారు. ${boardLabel} SCERT పాఠ్యపుస్తకం నుండి Markdown ఆకృతిలో నిర్మాణాత్మక అధ్యయన గమనికలను వెలికితీయండి. Include: title, key concepts as H2, definitions, formulas. Preserve Telugu terms. Output in Telugu.`
      : `You are a curriculum content extractor. Given text from a ${boardLabel} SCERT textbook, produce structured study notes in Markdown.`;

    let aiContent: string | null = null;
    let modelUsed = "";
    for (const model of models) {
      try {
        const r = await aiChat(`Extract study notes.\nBoard: ${boardLabel}\nClass: ${grade}\nSubject: ${subjectName}\n\nText:\n${text.slice(0, 30000)}`, { model, systemPrompt, temperature: 0.2, maxTokens: 8192, language });
        aiContent = r.content; modelUsed = r.model; break;
      } catch (err) { if (model === models[models.length - 1]) throw err; if (isAuthError(err) || isQuotaError(err)) continue; throw err; }
    }
    if (!aiContent) throw new Error("All AI models failed");

    await db.insert(contentItems).values({
      topicId: topic.id, contentType: "note",
      title: `${subjectName} (${boardLabel}, Class ${grade}, ${medium})`,
      body: aiContent, bodyFormat: "markdown", sourceType: `${boardCode.toLowerCase()}_scert`,
      sourceUrl: url, language, qualityScore: computeQualityScore(aiContent ?? "").toFixed(2), reviewStatus: "pending",
      isPublished: false, metadata: { board: boardCode, grade, medium, pdfPath: localPath, aiModel: modelUsed, importedAt: new Date().toISOString() },
    });
    return "parsed";
  }
}

// Helpers
function detectMedium(url: string): "english" | "telugu" { const l = url.toLowerCase(); return l.includes("telugu") || l.includes("_te") ? "telugu" : "english"; }
function inferGrade(url: string): number { const m = url.match(/(?:class|std|grade)[_-]?(\d{1,2})/i); if (m) { const g = parseInt(m[1], 10); if (g >= 1 && g <= 12) return g; } return 0; }
function inferSubject(f: string): string {
  const l = f.toLowerCase();
  if (l.includes("math")) return "Mathematics"; if (l.includes("science")) return "Science"; if (l.includes("social")) return "Social Science";
  if (l.includes("english")) return "English"; if (l.includes("telugu")) return "Telugu"; if (l.includes("hindi")) return "Hindi";
  if (l.includes("physics")) return "Physics"; if (l.includes("chemistry")) return "Chemistry"; if (l.includes("biology")) return "Biology";
  return f.replace(/\.pdf$/i, "").replace(/[_-]/g, " ");
}
function saveLocally(board: string, grade: number, medium: string, filename: string, buffer: Buffer): string {
  const dir = join(DATA_DIR, board, String(grade), medium); if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const s = filename.replace(/[^a-zA-Z0-9._-]/g, "_"); writeFileSync(join(dir, s), buffer); return `data/ap-telangana/${board}/${grade}/${medium}/${s}`;
}
async function findOrCreateStandard(boardId: number, grade: number) {
  const ay = "2025-26";
  const [e] = await db.select({ id: standards.id }).from(standards).where(and(eq(standards.boardId, boardId), eq(standards.grade, grade), eq(standards.academicYear, ay))).limit(1); if (e) return e;
  try { const [c] = await db.insert(standards).values({ boardId, grade, academicYear: ay, isActive: true, metadata: { source: "ap_ts_scraper" } }).returning({ id: standards.id }); return c ?? null; }
  catch { const [r] = await db.select({ id: standards.id }).from(standards).where(and(eq(standards.boardId, boardId), eq(standards.grade, grade), eq(standards.academicYear, ay))).limit(1); return r ?? null; }
}
async function findOrCreateSubject(sid: number, code: string, name: string) { const [e] = await db.select({ id: subjects.id }).from(subjects).where(and(eq(subjects.standardId, sid), eq(subjects.code, code))).limit(1); if (e) return e; const [c] = await db.insert(subjects).values({ standardId: sid, code, name, subjectType: "theory", isElective: false, metadata: { source: "ap_ts_scert" } }).returning({ id: subjects.id }); return c; }
async function findOrCreateChapter(sid: number, n: number, title: string) { const [e] = await db.select({ id: chapters.id }).from(chapters).where(and(eq(chapters.subjectId, sid), eq(chapters.chapterNumber, n))).limit(1); if (e) return e; const [c] = await db.insert(chapters).values({ subjectId: sid, chapterNumber: n, title, sortOrder: n, metadata: { source: "ap_ts_scert" } }).returning({ id: chapters.id }); return c; }
async function findOrCreateTopic(cid: number, title: string) { const [e] = await db.select({ id: topics.id }).from(topics).where(eq(topics.chapterId, cid)).limit(1); if (e) return e; const [c] = await db.insert(topics).values({ chapterId: cid, title, sortOrder: 1, metadata: { source: "ap_ts_scert" } }).returning({ id: topics.id }); return c; }
