/**
 * Kerala SCERT Syllabus Scraper
 *
 * Pipeline: Fetch SCERT Kerala curriculum page -> Find PDF links -> Download PDFs ->
 *           Extract text -> Send to Claude for parsing -> Validate ->
 *           Insert into boards/standards/subjects/chapters/topics
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { boards } from "@/db/schema/curriculum";
import { BaseScraper } from "./base-scraper";
import { extractTextFromPdf, extractLinks, resolveUrl } from "./parser";
import { insertParsedSyllabus } from "./syllabus-inserter";
import { resolveModelWithFallbacks } from "./ai-model-resolver";
import { aiChat } from "../ai/provider";
import type { AIProviderChoice } from "../queue";
import {
  SYSTEM_PROMPT,
  buildUserPrompt,
  parseResponse,
  config as promptConfig,
  type SyllabusParseResult,
} from "../ai/prompts/syllabus-parser";

const SCERT_BASE = "https://scert.kerala.gov.in";
// SCERT Kerala publishes curriculum and textbooks
const SCERT_SYLLABUS_PAGES = [
  `${SCERT_BASE}/curriculum`,
  `${SCERT_BASE}/syllabus`,
  `${SCERT_BASE}/textbooks`,
];

const PDF_LINK_PATTERN = /\.pdf$/i;

export interface KeralaScrapeOptions {
  grades?: number[];
  subjectFilter?: string;
  jobId?: number;
  maxPdfs?: number;
  /** AI provider to use for parsing */
  aiProvider?: AIProviderChoice;
  /** Filter by medium (English or Malayalam) */
  medium?: "english" | "malayalam";
  /**
   * Academic year ("YYYY-YY"). Threaded into SourceContext so inserted
   * rows land in the right year bucket. SCERT Kerala doesn't rotate URLs
   * per year (they overwrite the same curriculum page), so the scraper
   * can't infer the year itself — the admin UI supplies it.
   */
  academicYear?: string;
}

export class KeralaScraper extends BaseScraper {
  name = "Kerala SCERT Scraper";
  boardCode = "KL_SCERT";

  async scrape(options?: KeralaScrapeOptions): Promise<number> {
    const jobId = options?.jobId;
    let itemsProcessed = 0;

    try {
      const [board] = await db
        .select()
        .from(boards)
        .where(eq(boards.code, "KL_SCERT"))
        .limit(1);

      if (!board) {
        throw new Error("Kerala SCERT board not found in database. Run seed first.");
      }

      this.log(`Starting Kerala SCERT syllabus scrape (board id: ${board.id})`);

      // Collect PDF links from multiple pages
      const allPdfLinks: string[] = [];

      for (const pageUrl of SCERT_SYLLABUS_PAGES) {
        this.log(`Fetching: ${pageUrl}`);
        const pageResult = await this.fetchText(pageUrl);

        if (!pageResult.success || !pageResult.data) {
          this.log(`  Failed to fetch: ${pageResult.error}. Trying next page...`);
          continue;
        }

        const links = extractLinks(pageResult.data, PDF_LINK_PATTERN).map((link) =>
          resolveUrl(SCERT_BASE, link)
        );
        this.log(`  Found ${links.length} PDF links`);
        allPdfLinks.push(...links);
      }

      // Deduplicate
      let pdfLinks = [...new Set(allPdfLinks)];

      // Filter by medium if specified
      if (options?.medium) {
        const mediumPattern = new RegExp(options.medium, "i");
        pdfLinks = pdfLinks.filter((link) => mediumPattern.test(link));
        this.log(`Filtered to ${pdfLinks.length} links for medium: ${options.medium}`);
      }

      this.log(`Total unique PDF links: ${pdfLinks.length}`);

      if (pdfLinks.length === 0) {
        this.log("No PDF links found. The page structure may have changed.");
        return 0;
      }

      const maxPdfs = options?.maxPdfs ?? pdfLinks.length;
      const toProcess = pdfLinks.slice(0, maxPdfs);

      if (jobId) {
        await this.updateJob(jobId, {
          status: "running",
          itemsFound: toProcess.length,
        });
      }

      for (let i = 0; i < toProcess.length; i++) {
        const pdfUrl = toProcess[i];
        this.log(`\n[${i + 1}/${toProcess.length}] Processing: ${pdfUrl}`);

        try {
          const result = await this.processPdf(pdfUrl, board.id, options);
          if (result) {
            itemsProcessed++;
          }
        } catch (err) {
          this.logError(`Failed to process PDF: ${pdfUrl}`, err);
        }

        if (jobId) {
          await this.updateJob(jobId, { itemsProcessed: i + 1 });
        }
      }

      this.log(`\nScrape complete. Processed ${itemsProcessed}/${toProcess.length} PDFs.`);
      return itemsProcessed;
    } catch (err) {
      this.logError("Scrape failed", err);
      if (jobId) {
        await this.updateJob(jobId, {
          status: "failed",
          errorLog: err instanceof Error ? err.message : String(err),
        });
      }
      throw err;
    }
  }

  private async processPdf(
    pdfUrl: string,
    boardId: number,
    options?: KeralaScrapeOptions
  ): Promise<boolean> {
    this.log("  Downloading PDF...");
    const pdfResult = await this.fetchPdf(pdfUrl);
    if (!pdfResult.success || !pdfResult.data) {
      this.logError(`  Download failed: ${pdfResult.error}`);
      return false;
    }
    this.log(`  Downloaded (${(pdfResult.data.length / 1024).toFixed(1)} KB)`);

    this.log("  Extracting text...");
    let pdfText: string;
    try {
      pdfText = await extractTextFromPdf(pdfResult.data);
    } catch (err) {
      this.logError("  PDF text extraction failed", err);
      return false;
    }

    if (pdfText.trim().length < 100) {
      this.log("  Skipping — PDF text too short (likely image-only or empty)");
      return false;
    }
    this.log(`  Extracted ${pdfText.length} chars`);

    const grade = this.inferGrade(pdfUrl, pdfText);
    if (!grade) {
      this.log("  Skipping — could not determine grade/class from PDF");
      return false;
    }

    if (options?.grades && !options.grades.includes(grade)) {
      this.log(`  Skipping — grade ${grade} not in requested grades`);
      return false;
    }

    this.log(`  Detected grade: Class ${grade}`);

    const models = resolveModelWithFallbacks(options?.aiProvider);
    this.log(`  Sending to AI for parsing (trying: ${models.join(", ")})...`);
    const userPrompt = buildUserPrompt({
      pdfText,
      boardCode: "KL_SCERT",
      grade,
      subjectHint: options?.subjectFilter,
    });

    let aiResult = null;
    for (const model of models) {
      try {
        aiResult = await aiChat(userPrompt, {
          model,
          systemPrompt: SYSTEM_PROMPT,
          temperature: promptConfig.temperature,
          maxTokens: promptConfig.maxTokens,
        });
        this.log(
          `  AI response (${model}): ${aiResult.inputTokens} in / ${aiResult.outputTokens} out ($${aiResult.costUsd.toFixed(4)})`
        );
        break;
      } catch (err) {
        this.logError(`  AI call failed with model ${model}`, err);
        if (model === models[models.length - 1]) throw err;
        this.log(`  Falling back to next model...`);
      }
    }
    if (!aiResult) throw new Error("All AI models failed");

    let parsed: SyllabusParseResult;
    try {
      parsed = parseResponse(aiResult.content);
    } catch (err) {
      this.logError("  AI response validation failed", err);
      return false;
    }

    this.log(
      `  Parsed: ${parsed.subjectName} (${parsed.subjectCode}) — ${parsed.chapters.length} chapters`
    );

    this.log("  Inserting into database...");
    // SourceContext was previously not passed — every Kerala-inserted row
    // had empty provenance. Now we thread pdfUrl + ai model + scrape job +
    // year so the admin UI can trace a topic back to its source PDF and
    // syllabus-inserter can pin the year.
    await insertParsedSyllabus(boardId, grade, parsed, (msg) => this.log(msg), {
      pdfUrl,
      aiModel: aiResult.model,
      scrapeJobId: options?.jobId,
      boardCode: "KL_SCERT",
      academicYear: options?.academicYear,
    });
    this.log("  Done.");

    return true;
  }

  /**
   * Infer grade from URL or text.
   * Kerala uses "Standard" terminology in addition to "Class".
   */
  private inferGrade(url: string, text: string): number | null {
    const urlPatterns = [
      /class[_-]?(\d{1,2})/i,
      /grade[_-]?(\d{1,2})/i,
      /std[_-]?(\d{1,2})/i,
      /standard[_-]?(\d{1,2})/i,
      /(\d{1,2})th/i,
    ];
    for (const pattern of urlPatterns) {
      const match = url.match(pattern);
      if (match) {
        const grade = parseInt(match[1], 10);
        if (grade >= 1 && grade <= 12) return grade;
      }
    }

    const romanMap: Record<string, number> = {
      XII: 12, XI: 11, X: 10, IX: 9, VIII: 8, VII: 7, VI: 6, V: 5, IV: 4,
    };
    for (const [roman, num] of Object.entries(romanMap)) {
      if (url.toUpperCase().includes(roman)) return num;
    }

    const head = text.slice(0, 2000);
    // Kerala uses both "Class" and "Standard"
    const textPatterns = [
      /class[:\s-]*(\d{1,2})/i,
      /standard[:\s-]*(\d{1,2})/i,
    ];
    for (const pattern of textPatterns) {
      const match = head.match(pattern);
      if (match) {
        const grade = parseInt(match[1], 10);
        if (grade >= 1 && grade <= 12) return grade;
      }
    }

    return null;
  }
}
