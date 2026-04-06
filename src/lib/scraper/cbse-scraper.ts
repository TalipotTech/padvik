/**
 * CBSE Syllabus Scraper
 *
 * Pipeline: Fetch curriculum page -> Find PDF links -> Download PDFs ->
 *           Extract text -> Send to Claude for parsing -> Validate ->
 *           Insert into boards/standards/subjects/chapters/topics
 *
 * CBSE URLs use /Sec/ (Classes IX-X) and /SrSec/ (Classes XI-XII).
 * Each PDF covers a grade range, so we process for multiple grades.
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { boards } from "@/db/schema/curriculum";
import { contentPipelineLogs } from "@/db/schema/system";
import { BaseScraper } from "./base-scraper";
import { extractTextFromPdf, extractLinks, resolveUrl } from "./parser";
import { insertParsedSyllabus, type SourceContext } from "./syllabus-inserter";
import { savePdfLocally, saveExtractedText } from "./pdf-storage";
import { resolveModelWithFallbacks } from "./ai-model-resolver";
import { aiChat, isAuthError, isQuotaError } from "../ai/provider";
import type { AIProviderChoice } from "../queue";
import {
  SYSTEM_PROMPT,
  buildUserPrompt,
  parseResponse,
  config as promptConfig,
  type SyllabusParseResult,
} from "../ai/prompts/syllabus-parser";

const CBSE_CURRICULUM_BASE = "https://cbseacademic.nic.in";
const CBSE_CURRICULUM_PAGE = `${CBSE_CURRICULUM_BASE}/curriculum_2026.html`;

const PDF_LINK_PATTERN = /\.pdf$/i;

/** CBSE URL path segments map to grade ranges */
const CBSE_SECTION_GRADES: Record<string, number[]> = {
  sec: [9, 10],
  srsec: [11, 12],
};

export interface CbseScrapeOptions {
  grades?: number[];
  subjectFilter?: string;
  jobId?: number;
  maxPdfs?: number;
  aiProvider?: AIProviderChoice;
  /** URLs already processed (for resume after failure) */
  processedUrls?: string[];
}

/** Detailed result of a scrape run */
export interface ScrapeRunResult {
  processed: number;
  failed: number;
  skipped: number;
  total: number;
  failedUrls: string[];
  failedReasons: Record<string, string>;
  processedUrls: string[];
}

export class CbseScraper extends BaseScraper {
  name = "CBSE Scraper";
  boardCode = "CBSE";

  async scrape(options?: CbseScrapeOptions): Promise<number> {
    const result = await this.scrapeWithDetails(options);
    return result.processed;
  }

  /** Full scrape with detailed result tracking */
  async scrapeWithDetails(options?: CbseScrapeOptions): Promise<ScrapeRunResult> {
    const jobId = options?.jobId;
    const result: ScrapeRunResult = {
      processed: 0,
      failed: 0,
      skipped: 0,
      total: 0,
      failedUrls: [],
      failedReasons: {},
      processedUrls: options?.processedUrls ? [...options.processedUrls] : [],
    };

    try {
      const [board] = await db
        .select()
        .from(boards)
        .where(eq(boards.code, "CBSE"))
        .limit(1);

      if (!board) {
        throw new Error("CBSE board not found in database. Run seed first.");
      }

      this.log(`Starting CBSE syllabus scrape (board id: ${board.id})`);

      // Fetch the curriculum index page
      this.log(`Fetching curriculum page: ${CBSE_CURRICULUM_PAGE}`);
      const pageResult = await this.fetchText(CBSE_CURRICULUM_PAGE);

      if (!pageResult.success || !pageResult.data) {
        throw new Error(`Failed to fetch curriculum page: ${pageResult.error}`);
      }

      // Extract PDF links
      const allPdfLinks = extractLinks(pageResult.data, PDF_LINK_PATTERN).map((link) =>
        resolveUrl(CBSE_CURRICULUM_BASE, link)
      );
      this.log(`Found ${allPdfLinks.length} PDF links on page`);

      if (allPdfLinks.length === 0) {
        this.log("No PDF links found. The page structure may have changed.");
        return result;
      }

      // Filter out overview/general curriculum PDFs
      const SKIP_FILENAME_PATTERNS = [
        /^curriculum_sec/i,
        /^curriculum_srsec/i,
        /^initial[_-]?page/i,
        /^front[_-]?page/i,
        /^internal[_-]?assessment/i,
        /^reading[_-]?material/i,
      ];
      let pdfLinks = allPdfLinks.filter((url) => {
        const filename = url.split("/").pop() ?? "";
        return !SKIP_FILENAME_PATTERNS.some((p) => p.test(filename));
      });
      this.log(`Filtered to ${pdfLinks.length} subject-specific PDFs (skipped ${allPdfLinks.length - pdfLinks.length} overview PDFs)`);

      // Filter by grade if specified
      if (options?.grades && options.grades.length > 0) {
        pdfLinks = pdfLinks.filter((url) => {
          const grades = this.inferGrades(url);
          return grades.some((g) => options.grades!.includes(g));
        });
        this.log(`Filtered to ${pdfLinks.length} PDFs matching grades: ${options.grades.join(", ")}`);
      }

      // Limit
      const maxPdfs = options?.maxPdfs ?? pdfLinks.length;
      const toProcess = pdfLinks.slice(0, maxPdfs);
      result.total = toProcess.length;

      // Skip already-processed URLs (resume support)
      const alreadyDone = new Set(result.processedUrls);
      if (alreadyDone.size > 0) {
        this.log(`Resuming: ${alreadyDone.size} PDFs already processed, skipping them`);
      }

      if (jobId) {
        await this.updateJob(jobId, {
          status: "running",
          itemsFound: toProcess.length,
        });
      }

      // Process each PDF
      let consecutiveAuthFailures = 0;

      for (let i = 0; i < toProcess.length; i++) {
        const pdfUrl = toProcess[i];

        // Skip already processed (resume support)
        if (alreadyDone.has(pdfUrl)) {
          result.skipped++;
          continue;
        }

        this.log(`\n[${i + 1}/${toProcess.length}] Processing: ${pdfUrl}`);

        try {
          const success = await this.processPdf(pdfUrl, board.id, options, jobId);
          if (success) {
            result.processed++;
            result.processedUrls.push(pdfUrl);
            consecutiveAuthFailures = 0; // Reset on success
          } else {
            result.skipped++; // Skipped (text too short, wrong grade, etc.)
          }
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          result.failed++;
          result.failedUrls.push(pdfUrl);
          result.failedReasons[pdfUrl.split("/").pop() ?? pdfUrl] = errMsg;
          this.logError(`Failed to process PDF: ${pdfUrl}`, err);

          // Track consecutive auth failures — if all providers are down, stop early
          if (isAuthError(err) || isQuotaError(err)) {
            consecutiveAuthFailures++;
            if (consecutiveAuthFailures >= 3) {
              this.log(`\n⚠ ${consecutiveAuthFailures} consecutive auth/quota failures — stopping early to avoid wasting requests`);
              this.log(`  Processed ${result.processed} PDFs successfully before stopping`);
              this.log(`  Resume this job to continue from where it stopped`);
              break;
            }
          } else {
            consecutiveAuthFailures = 0;
          }
        }

        if (jobId) {
          await this.updateJob(jobId, { itemsProcessed: result.processed });
        }
      }

      this.log(`\n=== Scrape Summary ===`);
      this.log(`Total: ${result.total} | Processed: ${result.processed} | Failed: ${result.failed} | Skipped: ${result.skipped}`);
      if (result.failedUrls.length > 0) {
        this.log(`Failed PDFs:`);
        for (const [filename, reason] of Object.entries(result.failedReasons)) {
          this.log(`  - ${filename}: ${reason.slice(0, 100)}`);
        }
      }

      // Save summary to job metadata
      if (jobId) {
        await this.updateJobMetadata(jobId, {
          scrapeResult: {
            processed: result.processed,
            failed: result.failed,
            skipped: result.skipped,
            total: result.total,
            failedUrls: result.failedUrls,
            processedUrls: result.processedUrls,
          },
        });
      }

      return result;
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

  /**
   * Process a single syllabus PDF with full pipeline logging.
   */
  private async processPdf(
    pdfUrl: string,
    boardId: number,
    options?: CbseScrapeOptions,
    jobId?: number
  ): Promise<boolean> {
    const pdfStartTime = Date.now();
    const filename = pdfUrl.split("/").pop() ?? pdfUrl;
    const logEntityId = jobId ?? 0;

    // Step 1: Download PDF
    this.log("  Downloading PDF...");
    const pdfResult = await this.fetchPdf(pdfUrl);
    if (!pdfResult.success || !pdfResult.data) {
      this.logError(`  Download failed: ${pdfResult.error}`);
      await this.logPipeline("pdf_download", logEntityId, "failed", {
        url: pdfUrl, filename, error: pdfResult.error,
      });
      return false;
    }
    const pdfSizeKb = (pdfResult.data.length / 1024).toFixed(1);
    this.log(`  Downloaded (${pdfSizeKb} KB)`);

    // Step 2: Extract text from PDF
    this.log("  Extracting text...");
    let pdfText: string;
    try {
      pdfText = await extractTextFromPdf(pdfResult.data);
    } catch (err) {
      this.logError("  PDF text extraction failed", err);
      await this.logPipeline("text_extraction", logEntityId, "failed", {
        url: pdfUrl, filename, error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }

    if (pdfText.trim().length < 100) {
      this.log("  Skipping — PDF text too short (likely image-only or empty)");
      return false;
    }
    this.log(`  Extracted ${pdfText.length} chars`);

    // Step 2b: Determine grades early (needed for PDF storage path)
    // Step 3: Determine grade(s)
    const grades = this.inferGrades(pdfUrl);
    if (grades.length === 0) {
      this.log("  Could not infer grade from URL, will let AI determine it");
      grades.push(0);
    } else {
      this.log(`  Detected grades: ${grades.map((g) => `Class ${g}`).join(", ")}`);
    }

    const filteredGrades =
      options?.grades && options.grades.length > 0
        ? grades.filter((g) => g === 0 || options.grades!.includes(g))
        : grades;

    if (filteredGrades.length === 0) {
      this.log(`  Skipping — no matching grades in request`);
      return false;
    }

    // Step 3b: Save PDF and text locally
    const primaryGrade = filteredGrades[0] === 0 ? 10 : filteredGrades[0];
    let pdfPath: string | undefined;
    let textPath: string | undefined;
    try {
      pdfPath = savePdfLocally(pdfResult.data, "CBSE", primaryGrade, filename);
      textPath = saveExtractedText(pdfText, "CBSE", primaryGrade, filename);
      this.log(`  Saved locally: ${pdfPath}`);
    } catch (err) {
      this.logError("  Failed to save PDF locally (continuing)", err);
    }

    await this.logPipeline("text_extraction", logEntityId, "completed", {
      url: pdfUrl, filename, textLength: pdfText.length, sizeKb: pdfSizeKb,
      pdfPath, textPath,
    }, Date.now() - pdfStartTime);

    // Step 4: Send to AI for parsing
    const aiStartTime = Date.now();
    const models = resolveModelWithFallbacks(options?.aiProvider);
    this.log(`  Sending to AI for parsing (models: ${models.join(", ")})...`);

    const userPrompt = buildUserPrompt({
      pdfText,
      boardCode: "CBSE",
      grade: primaryGrade,
      subjectHint: options?.subjectFilter,
    });

    let aiResult = null;
    let modelUsed = "";
    for (const model of models) {
      try {
        const isGemini = model.startsWith("gemini-");
        aiResult = await aiChat(userPrompt, {
          model,
          systemPrompt: SYSTEM_PROMPT,
          temperature: promptConfig.temperature,
          maxTokens: promptConfig.maxTokens,
          jsonOutput: isGemini,
        });
        modelUsed = model;
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

    // Log AI call
    await this.logPipeline("ai_parse", logEntityId, "completed", {
      url: pdfUrl, filename, grades: filteredGrades,
      inputTokens: aiResult.inputTokens,
      outputTokens: aiResult.outputTokens,
      costUsd: aiResult.costUsd,
    }, Date.now() - aiStartTime, modelUsed, aiResult.inputTokens + aiResult.outputTokens);

    // Step 5: Parse and validate
    let parsed: SyllabusParseResult;
    try {
      parsed = parseResponse(aiResult.content);
    } catch (err) {
      this.logError("  AI response validation failed", err);
      await this.logPipeline("validation", logEntityId, "failed", {
        url: pdfUrl, filename, model: modelUsed,
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }

    const topicCount = parsed.chapters.reduce((sum, ch) => sum + ch.topics.length, 0);
    this.log(
      `  Parsed: ${parsed.subjectName} (${parsed.subjectCode}) — ${parsed.chapters.length} chapters, ${topicCount} topics`
    );

    // Step 6: Insert into database with provenance
    const insertGrades =
      filteredGrades[0] === 0 ? [parsed.grade] : filteredGrades;

    const sourceContext: SourceContext = {
      pdfPath,
      textPath,
      pdfUrl,
      aiModel: modelUsed,
      scrapeJobId: jobId,
      boardCode: "CBSE",
    };

    for (const grade of insertGrades) {
      this.log(`  Inserting into database for Class ${grade}...`);
      const result = await insertParsedSyllabus(
        boardId, grade, parsed, (msg) => this.log(msg), sourceContext
      );

      await this.logPipeline("db_insert", logEntityId, "completed", {
        url: pdfUrl, filename, grade, subject: parsed.subjectName,
        subjectCode: parsed.subjectCode,
        chaptersInserted: result.chaptersInserted,
        topicsInserted: result.topicsInserted,
        subjectId: result.subjectId,
        pdfPath, textPath,
        model: modelUsed,
        costUsd: aiResult.costUsd,
      }, Date.now() - pdfStartTime, modelUsed, aiResult.inputTokens + aiResult.outputTokens);
    }
    this.log("  Done.");

    return true;
  }

  /**
   * Log a pipeline step to contentPipelineLogs.
   */
  private async logPipeline(
    stage: string,
    entityId: number,
    status: string,
    data: Record<string, unknown>,
    processingTimeMs?: number,
    aiModelUsed?: string,
    aiTokensUsed?: number
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
    } catch {
      // Don't fail the scrape if logging fails
    }
  }

  /**
   * Infer grade(s) from the PDF URL.
   */
  private inferGrades(url: string): number[] {
    const urlLower = url.toLowerCase();

    if (urlLower.includes("/srsec/") || urlLower.includes("_srsec")) {
      return [...CBSE_SECTION_GRADES.srsec];
    }
    if (urlLower.includes("/sec/") || urlLower.includes("_sec_") || urlLower.includes("_sec.")) {
      return [...CBSE_SECTION_GRADES.sec];
    }

    const urlPatterns = [
      /class[_-]?(\d{1,2})/i,
      /grade[_-]?(\d{1,2})/i,
      /std[_-]?(\d{1,2})/i,
    ];
    for (const pattern of urlPatterns) {
      const match = url.match(pattern);
      if (match) {
        const grade = parseInt(match[1], 10);
        if (grade >= 1 && grade <= 12) return [grade];
      }
    }

    const romanMap: Record<string, number> = {
      XII: 12, XI: 11, X: 10, IX: 9, VIII: 8, VII: 7, VI: 6, V: 5, IV: 4,
    };
    for (const [roman, num] of Object.entries(romanMap)) {
      if (url.toUpperCase().includes(roman)) return [num];
    }

    return [];
  }
}
