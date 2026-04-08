/**
 * Maharashtra State Board (MSBSHSE) Textbook PDF Downloader
 *
 * Source: ebalbharati.in (Maharashtra Balbharati — official textbook publisher)
 * Downloads textbook PDFs for Classes 1-12 in English and Marathi medium.
 *
 * Language routing: language='mr' → Gemini (via provider), language='en' → Claude
 * Board: MH_MSBSHSE
 *
 * Storage: data/maharashtra/{class}/{medium}/{subject}.pdf
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

const BOARD_CODE = "MH_MSBSHSE";
const BALBHARATI_BASE = "https://ebalbharati.in";
/** eBalbharati has a structured download page per standard */
const BALBHARATI_INDEX = `${BALBHARATI_BASE}/main/publicationpage`;
const PDF_LINK_PATTERN = /\.pdf$/i;
const DATA_DIR = join(process.cwd(), "data", "maharashtra");

export interface MaharashtraScrapeOptions {
  grades?: number[];
  medium?: "english" | "marathi" | "both";
  subjectFilter?: string;
  jobId?: number;
  maxPdfs?: number;
  aiProvider?: AIProviderChoice;
  downloadOnly?: boolean;
}

export interface MaharashtraScrapeResult {
  pdfLinks: number;
  downloaded: number;
  parsed: number;
  failed: number;
  skipped: number;
  errors: string[];
}

export class MaharashtraScraper extends BaseScraper {
  name = "Maharashtra Balbharati Scraper";
  boardCode = BOARD_CODE;

  async scrape(options?: MaharashtraScrapeOptions): Promise<number> {
    const result = await this.scrapeWithDetails(options);
    return result.downloaded;
  }

  async scrapeWithDetails(options?: MaharashtraScrapeOptions): Promise<MaharashtraScrapeResult> {
    const result: MaharashtraScrapeResult = {
      pdfLinks: 0, downloaded: 0, parsed: 0, failed: 0, skipped: 0, errors: [],
    };
    const jobId = options?.jobId;

    try {
      const [board] = await db.select().from(boards).where(eq(boards.code, BOARD_CODE)).limit(1);
      if (!board) throw new Error(`Board '${BOARD_CODE}' not found. Run seed first.`);

      this.log(`Starting Maharashtra textbook scrape (board id: ${board.id})`);
      if (jobId) await this.updateJob(jobId, { status: "running" });

      // eBalbharati has a centralized publication index
      this.log(`Fetching eBalbharati index...`);
      const indexResult = await this.fetchText(BALBHARATI_INDEX);
      if (!indexResult.success || !indexResult.data) {
        throw new Error(`Failed to fetch eBalbharati index: ${indexResult.error}`);
      }

      const allPdfLinks = extractLinks(indexResult.data, PDF_LINK_PATTERN)
        .map((link) => resolveUrl(BALBHARATI_BASE, link));

      const allLinks: Array<{ url: string; grade: number; medium: string }> = [];
      for (const url of allPdfLinks) {
        const grade = inferGradeFromUrl(url);
        if (grade === 0) continue;
        if (options?.grades && !options.grades.includes(grade)) continue;
        const medium = detectMedium(url);
        if (options?.medium && options.medium !== "both" && medium !== options.medium) continue;
        if (options?.subjectFilter && !url.toLowerCase().includes(options.subjectFilter.toLowerCase())) continue;
        allLinks.push({ url, grade, medium });
      }

      const seen = new Set<string>();
      const unique = allLinks.filter((l) => { if (seen.has(l.url)) return false; seen.add(l.url); return true; });
      result.pdfLinks = unique.length;
      this.log(`Found ${unique.length} textbook PDFs`);

      const toProcess = options?.maxPdfs ? unique.slice(0, options.maxPdfs) : unique;
      if (jobId) await this.updateJob(jobId, { itemsFound: toProcess.length });

      for (let i = 0; i < toProcess.length; i++) {
        const { url, grade, medium } = toProcess[i];
        const language = medium === "marathi" ? "mr" : "en";
        this.log(`\n[${i + 1}/${toProcess.length}] Class ${grade} (${medium}): ${url}`);

        try {
          const s = await this.processPdf(url, board.id, grade, language, medium, options);
          if (s === "parsed") { result.downloaded++; result.parsed++; }
          else if (s === "downloaded") result.downloaded++;
          else if (s === "skipped") result.skipped++;
          else result.failed++;
        } catch (err) {
          result.failed++;
          result.errors.push(`${url}: ${err instanceof Error ? err.message : String(err)}`);
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

  private async processPdf(url: string, boardId: number, grade: number, language: string, medium: string, options?: MaharashtraScrapeOptions): Promise<"parsed" | "downloaded" | "skipped" | "failed"> {
    const [existing] = await db.select({ id: contentItems.id }).from(contentItems).where(eq(contentItems.sourceUrl, url)).limit(1);
    if (existing) return "skipped";

    const pdfResult = await this.fetchPdf(url);
    if (!pdfResult.success || !pdfResult.data) return "failed";

    const filename = url.split("/").pop() ?? `mh_${Date.now()}.pdf`;
    const localPath = saveLocally(grade, medium, filename, pdfResult.data);
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
    const systemPrompt = language === "mr"
      ? `तुम्ही अभ्यासक्रम सामग्री काढणारे आहात. महाराष्ट्र बालभारती पाठ्यपुस्तकातून Markdown स्वरूपात संरचित अभ्यास नोट्स काढा. Include: title, key concepts as H2, definitions, formulas. Preserve Marathi terms. Output in Marathi.`
      : `You are a curriculum content extractor. Given text from a Maharashtra Balbharati textbook, produce structured study notes in Markdown.`;

    let aiContent: string | null = null;
    let modelUsed = "";
    for (const model of models) {
      try {
        const r = await aiChat(`Extract study notes.\nClass: ${grade}\nSubject: ${subjectName}\n\nText:\n${text.slice(0, 30000)}`, { model, systemPrompt, temperature: 0.2, maxTokens: 8192, language });
        aiContent = r.content; modelUsed = r.model; break;
      } catch (err) { if (model === models[models.length - 1]) throw err; if (isAuthError(err) || isQuotaError(err)) continue; throw err; }
    }
    if (!aiContent) throw new Error("All AI models failed");

    await db.insert(contentItems).values({
      topicId: topic.id, contentType: "note",
      title: `${subjectName} (Maharashtra, Class ${grade}, ${medium})`,
      body: aiContent, bodyFormat: "markdown", sourceType: "maharashtra_balbharati",
      sourceUrl: url, language, qualityScore: computeQualityScore(aiContent ?? "").toFixed(2), reviewStatus: "pending",
      isPublished: false, metadata: { board: BOARD_CODE, grade, medium, pdfPath: localPath, aiModel: modelUsed, importedAt: new Date().toISOString() },
    });
    return "parsed";
  }
}

function detectMedium(url: string): "english" | "marathi" { return url.toLowerCase().includes("marathi") || url.toLowerCase().includes("_mr") ? "marathi" : "english"; }
function inferGradeFromUrl(url: string): number {
  const m = url.match(/(?:std|class|grade)[_-]?(\d{1,2})/i); if (m) { const g = parseInt(m[1], 10); if (g >= 1 && g <= 12) return g; } return 0;
}
function inferSubject(f: string): string {
  const l = f.toLowerCase();
  if (l.includes("math")) return "Mathematics"; if (l.includes("science")) return "Science"; if (l.includes("social")) return "Social Science";
  if (l.includes("english")) return "English"; if (l.includes("marathi")) return "Marathi"; if (l.includes("hindi")) return "Hindi";
  if (l.includes("physics")) return "Physics"; if (l.includes("chemistry")) return "Chemistry"; if (l.includes("biology")) return "Biology";
  return f.replace(/\.pdf$/i, "").replace(/[_-]/g, " ");
}
function saveLocally(grade: number, medium: string, filename: string, buffer: Buffer): string {
  const dir = join(DATA_DIR, String(grade), medium); if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const s = filename.replace(/[^a-zA-Z0-9._-]/g, "_"); writeFileSync(join(dir, s), buffer); return `data/maharashtra/${grade}/${medium}/${s}`;
}
async function findOrCreateStandard(boardId: number, grade: number) {
  const ay = "2025-26";
  const [e] = await db.select({ id: standards.id }).from(standards).where(and(eq(standards.boardId, boardId), eq(standards.grade, grade), eq(standards.academicYear, ay))).limit(1); if (e) return e;
  try { const [c] = await db.insert(standards).values({ boardId, grade, academicYear: ay, isActive: true, metadata: { source: "maharashtra" } }).returning({ id: standards.id }); return c ?? null; }
  catch { const [r] = await db.select({ id: standards.id }).from(standards).where(and(eq(standards.boardId, boardId), eq(standards.grade, grade), eq(standards.academicYear, ay))).limit(1); return r ?? null; }
}
async function findOrCreateSubject(sid: number, code: string, name: string) { const [e] = await db.select({ id: subjects.id }).from(subjects).where(and(eq(subjects.standardId, sid), eq(subjects.code, code))).limit(1); if (e) return e; const [c] = await db.insert(subjects).values({ standardId: sid, code, name, subjectType: "theory", isElective: false, metadata: { source: "maharashtra_balbharati" } }).returning({ id: subjects.id }); return c; }
async function findOrCreateChapter(sid: number, n: number, title: string) { const [e] = await db.select({ id: chapters.id }).from(chapters).where(and(eq(chapters.subjectId, sid), eq(chapters.chapterNumber, n))).limit(1); if (e) return e; const [c] = await db.insert(chapters).values({ subjectId: sid, chapterNumber: n, title, sortOrder: n, metadata: { source: "maharashtra_balbharati" } }).returning({ id: chapters.id }); return c; }
async function findOrCreateTopic(cid: number, title: string) { const [e] = await db.select({ id: topics.id }).from(topics).where(eq(topics.chapterId, cid)).limit(1); if (e) return e; const [c] = await db.insert(topics).values({ chapterId: cid, title, sortOrder: 1, metadata: { source: "maharashtra_balbharati" } }).returning({ id: topics.id }); return c; }
