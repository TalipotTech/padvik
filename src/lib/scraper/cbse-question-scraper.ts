/**
 * CBSE Question Paper / Question Bank Scraper
 *
 * Pipeline: Fetch SQP/QB index page -> Find PDF links -> Download PDFs ->
 *           Extract text -> Send to AI for parsing -> Validate ->
 *           Insert into question_papers/questions tables
 *
 * Sources:
 *   SQP: https://cbseacademic.nic.in/SQP_CLASSX_2025-26.html (Class X)
 *         https://cbseacademic.nic.in/SQP_CLASSXII_2025-26.html (Class XII)
 *   QB:  https://cbseacademic.nic.in/qbclass10.html (Class X)
 *         https://cbseacademic.nic.in/qbclass12.html (Class XII)
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { boards } from "@/db/schema/curriculum";
import { contentPipelineLogs } from "@/db/schema/system";
import { BaseScraper } from "./base-scraper";
import { extractTextFromPdf, extractLinks, resolveUrl } from "./parser";
import {
  insertParsedQuestions,
  type QuestionSourceContext,
} from "./question-inserter";
import { savePdfLocally, saveExtractedText } from "./pdf-storage";
import { resolveModelWithFallbacks } from "./ai-model-resolver";
import { aiChat, aiVision, aiPdfVision, isAuthError, isQuotaError, AI_MODELS } from "../ai/provider";
import type { AIProviderChoice } from "../queue";
import {
  SYSTEM_PROMPT,
  buildUserPrompt,
  parseResponse,
  config as promptConfig,
  type QuestionPaperParseResult,
} from "../ai/prompts/question-paper-parser";

const CBSE_BASE = "https://cbseacademic.nic.in";

/** Source pages for different scrape types and grades */
const CBSE_QUESTION_SOURCES: Record<string, Record<number, string>> = {
  sqp: {
    10: `${CBSE_BASE}/SQP_CLASSX_2025-26.html`,
    12: `${CBSE_BASE}/SQP_CLASSXII_2025-26.html`,
  },
  qb: {
    10: `${CBSE_BASE}/qbclass10.html`,
    12: `${CBSE_BASE}/qbclass12.html`,
  },
};

const PDF_LINK_PATTERN = /\.pdf$/i;

export interface CbseQuestionScrapeOptions {
  grades?: number[];
  scrapeType?: "sqp" | "qb" | "both";
  subjectFilter?: string;
  jobId?: number;
  maxPdfs?: number;
  aiProvider?: AIProviderChoice;
  processedUrls?: string[];
  /** When true, only retry URLs that were NOT in processedUrls (i.e., previously failed/skipped) */
  retrySkipped?: boolean;
}

export interface QuestionScrapeRunResult {
  processed: number;
  failed: number;
  skipped: number;
  total: number;
  questionsExtracted: number;
  failedUrls: string[];
  failedReasons: Record<string, string>;
  processedUrls: string[];
}

export class CbseQuestionScraper extends BaseScraper {
  name = "CBSE Question Paper Scraper";
  boardCode = "CBSE";

  async scrape(options?: CbseQuestionScrapeOptions): Promise<number> {
    const result = await this.scrapeWithDetails(options);
    return result.processed;
  }

  async scrapeWithDetails(
    options?: CbseQuestionScrapeOptions
  ): Promise<QuestionScrapeRunResult> {
    const jobId = options?.jobId;
    const result: QuestionScrapeRunResult = {
      processed: 0,
      failed: 0,
      skipped: 0,
      total: 0,
      questionsExtracted: 0,
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

      this.log(`Starting CBSE question paper scrape (board id: ${board.id})`);

      // Determine which source pages to fetch
      const scrapeType = options?.scrapeType ?? "both";
      const gradesToScrape = options?.grades?.length
        ? options.grades
        : [10, 12];

      const sourcePages: { url: string; grade: number; type: string }[] = [];
      for (const grade of gradesToScrape) {
        if ((scrapeType === "sqp" || scrapeType === "both") && CBSE_QUESTION_SOURCES.sqp[grade]) {
          sourcePages.push({
            url: CBSE_QUESTION_SOURCES.sqp[grade],
            grade,
            type: "sqp",
          });
        }
        if ((scrapeType === "qb" || scrapeType === "both") && CBSE_QUESTION_SOURCES.qb[grade]) {
          sourcePages.push({
            url: CBSE_QUESTION_SOURCES.qb[grade],
            grade,
            type: "qb",
          });
        }
      }

      if (sourcePages.length === 0) {
        this.log("No source pages to scrape for the specified grades/types.");
        return result;
      }

      // Collect all PDF links from source pages
      const pdfEntries: { url: string; grade: number; type: string }[] = [];
      for (const page of sourcePages) {
        this.log(`Fetching index page: ${page.url}`);
        const pageResult = await this.fetchText(page.url);
        if (!pageResult.success || !pageResult.data) {
          this.log(`  Failed to fetch: ${pageResult.error}`);
          continue;
        }

        const links = extractLinks(pageResult.data, PDF_LINK_PATTERN).map((link) =>
          resolveUrl(CBSE_BASE, link)
        );
        this.log(`  Found ${links.length} PDF links on ${page.type} page for Class ${page.grade}`);

        for (const url of links) {
          pdfEntries.push({ url, grade: page.grade, type: page.type });
        }
      }

      if (pdfEntries.length === 0) {
        this.log("No PDF links found. Page structure may have changed.");
        return result;
      }

      // Apply max PDFs limit
      const maxPdfs = options?.maxPdfs ?? pdfEntries.length;
      const toProcess = pdfEntries.slice(0, maxPdfs);
      result.total = toProcess.length;

      // Skip/filter logic based on mode
      const alreadyDone = new Set(result.processedUrls);
      const retrySkippedMode = options?.retrySkipped === true;

      if (retrySkippedMode) {
        // In retry-skipped mode: ONLY process URLs NOT in processedUrls
        const skippedCount = toProcess.filter((e) => !alreadyDone.has(e.url)).length;
        this.log(`=== RETRY SKIPPED MODE: ${alreadyDone.size} already done, ${skippedCount} to retry ===`);
      } else if (alreadyDone.size > 0) {
        this.log(`=== RESUMING: ${alreadyDone.size} PDFs already processed, will skip them ===`);
        this.log(`Already done URLs: ${[...alreadyDone].map((u) => u.split("/").pop()).join(", ")}`);
      }

      if (jobId) {
        await this.updateJob(jobId, { status: "running", itemsFound: toProcess.length });
      }

      // Process each PDF
      let consecutiveAuthFailures = 0;

      for (let i = 0; i < toProcess.length; i++) {
        const entry = toProcess[i];

        if (retrySkippedMode) {
          // In retry mode: SKIP urls that were already successfully processed
          if (alreadyDone.has(entry.url)) {
            result.skipped++;
            continue;
          }
        } else {
          // Normal mode: skip already-done (resume support)
          if (alreadyDone.has(entry.url)) {
            result.skipped++;
            continue;
          }
        }

        this.log(`\n[${i + 1}/${toProcess.length}] Processing: ${entry.url}`);

        try {
          const qResult = await this.processQuestionPdf(
            entry.url,
            board.id,
            entry.grade,
            entry.type,
            options,
            jobId
          );
          if (qResult) {
            result.processed++;
            result.questionsExtracted += qResult.questionsInserted;
            result.processedUrls.push(entry.url);
            consecutiveAuthFailures = 0;
          } else {
            result.skipped++;
          }
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          result.failed++;
          result.failedUrls.push(entry.url);
          result.failedReasons[entry.url.split("/").pop() ?? entry.url] = errMsg;
          this.logError(`Failed to process: ${entry.url}`, err);

          if (isAuthError(err) || isQuotaError(err)) {
            consecutiveAuthFailures++;
            if (consecutiveAuthFailures >= 3) {
              this.log(
                `\n  ${consecutiveAuthFailures} consecutive auth/quota failures — stopping early`
              );
              break;
            }
          } else {
            consecutiveAuthFailures = 0;
          }
        }

        if (jobId) {
          await this.updateJob(jobId, { itemsProcessed: result.processed });
          // Save processedUrls after every PDF so restart/resume works even if cancelled mid-run
          await this.updateJobMetadata(jobId, {
            scrapeResult: {
              processed: result.processed,
              failed: result.failed,
              skipped: result.skipped,
              total: result.total,
              questionsExtracted: result.questionsExtracted,
              failedUrls: result.failedUrls,
              processedUrls: result.processedUrls,
            },
          });
        }
      }

      this.log(`\n=== Question Scrape Summary ===`);
      this.log(
        `Total: ${result.total} | Processed: ${result.processed} | Failed: ${result.failed} | Skipped: ${result.skipped}`
      );
      this.log(`Questions extracted: ${result.questionsExtracted}`);

      if (jobId) {
        await this.updateJobMetadata(jobId, {
          scrapeResult: {
            processed: result.processed,
            failed: result.failed,
            skipped: result.skipped,
            total: result.total,
            questionsExtracted: result.questionsExtracted,
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
   * Process a single question paper PDF.
   */
  private async processQuestionPdf(
    pdfUrl: string,
    boardId: number,
    grade: number,
    paperType: string,
    options?: CbseQuestionScrapeOptions,
    jobId?: number
  ): Promise<{ questionsInserted: number } | null> {
    const pdfStartTime = Date.now();
    const filename = pdfUrl.split("/").pop() ?? pdfUrl;
    const logEntityId = jobId ?? 0;

    // Step 1: Download PDF
    this.log("  Downloading PDF...");
    const pdfResult = await this.fetchPdf(pdfUrl);
    if (!pdfResult.success || !pdfResult.data) {
      this.logError(`  Download failed: ${pdfResult.error}`);
      await this.logPipeline("pdf_download", logEntityId, "failed", {
        url: pdfUrl,
        filename,
        error: pdfResult.error,
      });
      return null;
    }
    const pdfSizeKb = (pdfResult.data.length / 1024).toFixed(1);
    this.log(`  Downloaded (${pdfSizeKb} KB)`);

    // Step 2: Extract text
    this.log("  Extracting text...");
    let pdfText: string;
    try {
      pdfText = await extractTextFromPdf(pdfResult.data);
    } catch (err) {
      this.logError("  PDF text extraction failed", err);
      await this.logPipeline("text_extraction", logEntityId, "failed", {
        url: pdfUrl,
        filename,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }

    // Detect garbled text (image-heavy PDFs produce mostly garbage chars)
    const alphanumericRatio = (pdfText.match(/[a-zA-Z0-9\u0900-\u0D7F]/g) ?? []).length / Math.max(pdfText.length, 1);
    const isGarbled = pdfText.length > 200 && alphanumericRatio < 0.3;
    if (isGarbled) {
      this.log(`  Text appears garbled (${(alphanumericRatio * 100).toFixed(0)}% alphanumeric) — likely image-heavy PDF`);
    }

    // Step 2b: If text is too short or garbled, try OCR via AI Vision
    if (pdfText.trim().length < 200 || isGarbled) {
      this.log("  Text too short — attempting AI Vision OCR...");
      try {
        const base64 = pdfResult.data.toString("base64");
        const visionResult = await aiVision(
          "Extract all text from this question paper image. Include all questions, options, marks, and sections exactly as they appear.",
          base64,
          "image/png",
          { model: promptConfig.model }
        );
        pdfText = visionResult.content;
        this.log(`  OCR extracted ${pdfText.length} chars`);
      } catch (err) {
        this.logError("  AI Vision OCR also failed", err);
        return null;
      }
    }

    if (pdfText.trim().length < 100) {
      this.log("  Skipping — text too short after all extraction attempts");
      return null;
    }
    this.log(`  Extracted ${pdfText.length} chars`);

    // Step 3: Save locally
    let pdfPath: string | undefined;
    try {
      pdfPath = savePdfLocally(pdfResult.data, "CBSE", grade, filename);
      saveExtractedText(pdfText, "CBSE", grade, filename);
      this.log(`  Saved locally: ${pdfPath}`);
    } catch (err) {
      this.logError("  Failed to save locally (continuing)", err);
    }

    await this.logPipeline("text_extraction", logEntityId, "completed", {
      url: pdfUrl,
      filename,
      textLength: pdfText.length,
      sizeKb: pdfSizeKb,
      pdfPath,
    }, Date.now() - pdfStartTime);

    // Step 4: AI parsing
    const aiStartTime = Date.now();
    const models = resolveModelWithFallbacks(options?.aiProvider);

    // Try to infer subject from filename
    const subjectHint = this.inferSubjectFromFilename(filename);

    // Detect if the PDF likely has figures/diagrams
    const hasFigureRefs = /\b(figure|fig\.|diagram|image|picture|shown below|given below|observe the|look at the)\b/i.test(pdfText);
    const useVisionMode = hasFigureRefs && pdfResult.data.length < 10 * 1024 * 1024; // Vision mode for PDFs < 10MB with figure references

    if (useVisionMode) {
      this.log(`  Detected figure references — using PDF Vision mode (Gemini can see diagrams)`);
    } else {
      this.log(`  Using text parsing mode (models: ${models.join(", ")})`);
    }

    let aiResult = null;
    let modelUsed = "";

    if (useVisionMode) {
      // PDF Vision mode: send entire PDF to Gemini — it can see all figures/diagrams
      const pdfBase64 = pdfResult.data.toString("base64");
      // Estimate question count for the prompt
      const mainQs = (pdfText.match(/^\s*\d+\.\s/gm) ?? []).length;
      const subQs = new Set(pdfText.match(/\d+\.\d+/g) ?? []).size;
      const estTotal = subQs || mainQs || 0;

      const visionPrompt = [
        `Board: CBSE, Class/Grade: ${grade}, Paper Type: ${paperType}`,
        subjectHint ? `Subject: ${subjectHint}` : "",
        estTotal > 0 ? `This document has approximately ${estTotal} questions. Extract ALL of them.` : "",
        "",
        "Parse EVERY SINGLE question and sub-question from this PDF into structured JSON.",
        "",
        "CRITICAL RULES:",
        "1. For case studies with sub-questions (e.g., 1.1, 1.2, 1.3): extract EACH sub-question as a SEPARATE question entry, NOT as one combined question.",
        "2. For questions with figures/diagrams: describe the figure in [Figure: ...] brackets within questionText.",
        "3. Include ALL pages. Do NOT stop early.",
        "4. Each question must have: questionNumber, questionType, questionText, marks, difficulty.",
        "5. For MCQs: include options array with label, text, and isCorrect.",
        "",
        "Return ONLY valid JSON.",
      ].filter(Boolean).join("\n");

      const estimatedOutputTokens = Math.min(Math.max(32768, Math.ceil(pdfText.length * 0.8)), 65536);
      const visionModels = models.filter((m) => m.startsWith("gemini-"));
      if (visionModels.length === 0) visionModels.push("gemini-2.5-flash");

      for (const model of visionModels) {
        try {
          this.log(`  Sending PDF to ${model} vision...`);
          aiResult = await aiPdfVision(visionPrompt, pdfBase64, {
            model,
            systemPrompt: SYSTEM_PROMPT,
            temperature: promptConfig.temperature,
            maxTokens: estimatedOutputTokens,
            jsonOutput: true,
          });
          modelUsed = model;
          this.log(
            `  AI vision response (${model}): ${aiResult.inputTokens} in / ${aiResult.outputTokens} out ($${aiResult.costUsd.toFixed(4)})`
          );
          break;
        } catch (err) {
          this.logError(`  PDF vision failed with ${model}`, err);
          if (model === visionModels[visionModels.length - 1]) {
            this.log("  Falling back to text-only parsing...");
          }
        }
      }
    }

    // Text-only parsing (default or fallback from vision)
    if (!aiResult) {
      const userPrompt = buildUserPrompt({
        pdfText,
        boardCode: "CBSE",
        grade,
        paperType,
        subjectHint,
      });

      for (const model of models) {
        try {
          const isGemini = model.startsWith("gemini-");
          const estimatedOutputTokens = Math.min(
            Math.max(32768, Math.ceil(pdfText.length * 0.8)),
            65536
          );
          aiResult = await aiChat(userPrompt, {
            model,
            systemPrompt: SYSTEM_PROMPT,
            temperature: promptConfig.temperature,
            maxTokens: estimatedOutputTokens,
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
    }
    if (!aiResult) throw new Error("All AI models failed");

    await this.logPipeline(
      "ai_parse",
      logEntityId,
      "completed",
      {
        url: pdfUrl,
        filename,
        grade,
        paperType,
        inputTokens: aiResult.inputTokens,
        outputTokens: aiResult.outputTokens,
        costUsd: aiResult.costUsd,
      },
      Date.now() - aiStartTime,
      modelUsed,
      aiResult.inputTokens + aiResult.outputTokens
    );

    // Step 5: Parse and validate (with graceful fallback)
    let parsed: QuestionPaperParseResult;
    try {
      parsed = parseResponse(aiResult.content);
    } catch (err) {
      const zodError = err instanceof Error ? err.message : String(err);
      const rawResponsePreview = aiResult.content.slice(0, 1000);
      this.logError("  AI response validation failed, attempting graceful recovery", err);

      // Graceful fallback: try to extract whatever we can from raw JSON
      try {
        let rawJson = aiResult.content.trim();
        if (rawJson.startsWith("```")) {
          rawJson = rawJson.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
        }
        const raw = JSON.parse(rawJson);
        const totalRawQuestions = (raw.questions ?? []).length;

        // Build a minimal valid result from raw data
        const safeQuestions = (raw.questions ?? [])
          .filter((q: Record<string, unknown>) => q && (q.questionText || q.text))
          .map((q: Record<string, unknown>, i: number) => ({
            questionNumber: String(q.questionNumber ?? i + 1),
            sectionLabel: q.sectionLabel ? String(q.sectionLabel) : null,
            questionType: String(q.questionType ?? "short_answer").toLowerCase().replace(/\s+/g, "_"),
            questionText: String(q.questionText ?? q.text ?? ""),
            options: Array.isArray(q.options) ? q.options : undefined,
            correctAnswer: q.correctAnswer != null ? String(q.correctAnswer) : null,
            solution: q.solution != null ? String(q.solution) : null,
            marks: typeof q.marks === "number" ? q.marks : (parseFloat(String(q.marks)) || 1),
            chapterHint: q.chapterHint ? String(q.chapterHint) : null,
            topicHint: q.topicHint ? String(q.topicHint) : null,
            difficulty: ["easy", "medium", "hard"].includes(String(q.difficulty ?? "").toLowerCase())
              ? String(q.difficulty).toLowerCase()
              : "medium",
          }));

        parsed = {
          subjectName: String(raw.subjectName ?? "Unknown"),
          subjectCode: raw.subjectCode ? String(raw.subjectCode) : null,
          grade: parseInt(String(raw.grade)) || grade,
          paperYear: raw.paperYear ? parseInt(String(raw.paperYear)) : null,
          totalMarks: raw.totalMarks ? parseFloat(String(raw.totalMarks)) : null,
          durationMinutes: raw.durationMinutes ? parseInt(String(raw.durationMinutes)) : null,
          paperType: raw.paperType ? String(raw.paperType) : null,
          questions: safeQuestions,
        };

        this.log(`  Recovered ${safeQuestions.length} questions from ${totalRawQuestions} via graceful fallback`);

        // Log the recovery with details for the admin UI
        await this.logPipeline("validation_recovery", logEntityId, "recovered", {
          url: pdfUrl,
          filename,
          model: modelUsed,
          recoveryUsed: true,
          originalError: zodError.slice(0, 500),
          rawResponsePreview,
          totalRawQuestions,
          recoveredQuestions: safeQuestions.length,
          droppedQuestions: totalRawQuestions - safeQuestions.length,
        }, Date.now() - pdfStartTime, modelUsed, aiResult.inputTokens + aiResult.outputTokens);
      } catch (recoveryErr) {
        const recoveryError = recoveryErr instanceof Error ? recoveryErr.message : String(recoveryErr);
        this.logError("  Graceful recovery also failed", recoveryErr);

        // Log full failure with all diagnostic data
        await this.logPipeline("validation", logEntityId, "failed", {
          url: pdfUrl,
          filename,
          model: modelUsed,
          error: zodError.slice(0, 500),
          recoveryError: recoveryError.slice(0, 500),
          rawResponsePreview,
          grade,
          paperType,
          costUsd: aiResult.costUsd,
          inputTokens: aiResult.inputTokens,
          outputTokens: aiResult.outputTokens,
        }, Date.now() - pdfStartTime, modelUsed, aiResult.inputTokens + aiResult.outputTokens);

        return null;
      }
    }

    this.log(
      `  Parsed: ${parsed.subjectName} — ${parsed.questions.length} questions`
    );

    // Step 5b: Completeness check — if significantly fewer questions than expected, try continuation
    const mainQCount = (pdfText.match(/^\s*\d+\.\s/gm) ?? []).length;
    const subQCount = new Set(pdfText.match(/\d+\.\d+/g) ?? []).size;
    const estimatedTotal = subQCount || mainQCount || 0;

    if (estimatedTotal > 0 && parsed.questions.length < estimatedTotal * 0.7) {
      this.log(`  Incomplete: got ${parsed.questions.length}/${estimatedTotal} expected. Requesting continuation...`);

      const lastQ = parsed.questions[parsed.questions.length - 1];
      const lastQNum = lastQ?.questionNumber ?? "?";

      try {
        const contPrompt = [
          `Continue parsing from Q${lastQNum}. You already extracted ${parsed.questions.length} questions.`,
          `The document has ~${estimatedTotal} total. Extract ALL remaining questions after Q${lastQNum}.`,
          `Return ONLY the remaining questions as: { "questions": [...] }`,
          "",
          "---DOCUMENT TEXT---",
          pdfText.slice(0, 50000),
        ].join("\n");

        const contModel = modelUsed.startsWith("gemini-") ? modelUsed : AI_MODELS.GEMINI_FLASH;
        const isGemini = contModel.startsWith("gemini-");
        const contResult = await aiChat(contPrompt, {
          model: contModel as typeof AI_MODELS[keyof typeof AI_MODELS],
          systemPrompt: SYSTEM_PROMPT,
          temperature: promptConfig.temperature,
          maxTokens: 32768,
          jsonOutput: isGemini,
        });

        const contParsed = parseResponse(contResult.content);
        if (contParsed.questions.length > 0) {
          this.log(`  Continuation: +${contParsed.questions.length} questions (total now: ${parsed.questions.length + contParsed.questions.length})`);
          parsed = { ...parsed, questions: [...parsed.questions, ...contParsed.questions] };
        }
      } catch (contErr) {
        this.logError("  Continuation failed (using partial results)", contErr);
      }
    }

    // Step 6: Insert into database
    const sourceContext: QuestionSourceContext = {
      pdfPath,
      pdfUrl,
      aiModel: modelUsed,
      scrapeJobId: jobId,
      boardCode: "CBSE",
    };

    const insertResult = await insertParsedQuestions(
      boardId,
      grade,
      parsed,
      undefined,
      (msg) => this.log(msg),
      sourceContext
    );

    await this.logPipeline(
      "db_insert",
      logEntityId,
      "completed",
      {
        url: pdfUrl,
        filename,
        grade,
        subject: parsed.subjectName,
        questionsInserted: insertResult.questionsInserted,
        questionsSkipped: insertResult.questionsSkipped,
        topicsMapped: insertResult.topicsMapped,
        topicsUnmapped: insertResult.topicsUnmapped,
        questionPaperId: insertResult.questionPaperId,
        model: modelUsed,
        costUsd: aiResult.costUsd,
      },
      Date.now() - pdfStartTime,
      modelUsed,
      aiResult.inputTokens + aiResult.outputTokens
    );

    this.log("  Done.");
    return { questionsInserted: insertResult.questionsInserted };
  }

  /**
   * Try to infer a subject name from the PDF filename.
   */
  private inferSubjectFromFilename(filename: string): string | undefined {
    const normalized = filename.replace(/[-_]/g, " ").toLowerCase();
    const subjectPatterns: Record<string, RegExp> = {
      Mathematics: /math/i,
      Science: /science/i,
      "Social Science": /social\s*science|sst/i,
      English: /english/i,
      Hindi: /hindi/i,
      Physics: /physics|phy/i,
      Chemistry: /chemistry|chem/i,
      Biology: /biology|bio/i,
      "Computer Science": /computer|comp\s*sci|cs/i,
      Economics: /economics|eco/i,
      "Business Studies": /business/i,
      Accountancy: /accountancy|accounts/i,
      Geography: /geography|geo/i,
      History: /history/i,
      "Political Science": /political|pol\s*sci/i,
    };

    for (const [subject, pattern] of Object.entries(subjectPatterns)) {
      if (pattern.test(normalized)) return subject;
    }
    return undefined;
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
}
