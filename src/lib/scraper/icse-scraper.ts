/**
 * ICSE/ISC Syllabus Scraper
 *
 * Pipeline: Fetch CISCE publications page -> Find PDF links -> Download PDFs ->
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

const ICSE_BASE = "https://www.cisce.org";
// CISCE publishes syllabi under their regulations section
const ICSE_SYLLABUS_PAGES = [
  `${ICSE_BASE}/regulations-syllabi`,
  `${ICSE_BASE}/icse-syllabus`,
  `${ICSE_BASE}/isc-syllabus`,
];

const PDF_LINK_PATTERN = /\.pdf$/i;

export interface IcseScrapeOptions {
  grades?: number[];
  subjectFilter?: string;
  jobId?: number;
  maxPdfs?: number;
  aiProvider?: AIProviderChoice;
}

export class IcseScraper extends BaseScraper {
  name = "ICSE Scraper";
  boardCode = "ICSE";

  async scrape(options?: IcseScrapeOptions): Promise<number> {
    const jobId = options?.jobId;
    let itemsProcessed = 0;

    try {
      const [board] = await db
        .select()
        .from(boards)
        .where(eq(boards.code, "ICSE"))
        .limit(1);

      if (!board) {
        throw new Error("ICSE board not found in database. Run seed first.");
      }

      this.log(`Starting ICSE syllabus scrape (board id: ${board.id})`);

      // Collect PDF links from multiple pages
      const allPdfLinks: string[] = [];

      for (const pageUrl of ICSE_SYLLABUS_PAGES) {
        this.log(`Fetching: ${pageUrl}`);
        const pageResult = await this.fetchText(pageUrl);

        if (!pageResult.success || !pageResult.data) {
          this.log(`  Failed to fetch: ${pageResult.error}. Trying next page...`);
          continue;
        }

        const links = extractLinks(pageResult.data, PDF_LINK_PATTERN).map((link) =>
          resolveUrl(ICSE_BASE, link)
        );
        this.log(`  Found ${links.length} PDF links`);
        allPdfLinks.push(...links);
      }

      // Deduplicate
      const pdfLinks = [...new Set(allPdfLinks)];
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
    options?: IcseScrapeOptions
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
      boardCode: "ICSE",
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
    await insertParsedSyllabus(boardId, grade, parsed, (msg) => this.log(msg));
    this.log("  Done.");

    return true;
  }

  /**
   * Infer grade from URL or text.
   * ICSE uses "Class X" notation. ISC is for Class 11-12.
   */
  private inferGrade(url: string, text: string): number | null {
    const urlPatterns = [
      /class[_-]?(\d{1,2})/i,
      /grade[_-]?(\d{1,2})/i,
      /std[_-]?(\d{1,2})/i,
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
    const textMatch = head.match(/class[:\s-]*(\d{1,2})/i);
    if (textMatch) {
      const grade = parseInt(textMatch[1], 10);
      if (grade >= 1 && grade <= 12) return grade;
    }

    return null;
  }
}
