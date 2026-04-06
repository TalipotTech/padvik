/**
 * BullMQ worker for file upload processing.
 * Handles text extraction and question parsing from uploaded files.
 *
 * Supported file types:
 * - PDF: text extraction via pdf-parse, OCR fallback via AI Vision
 * - Image (jpg/png/webp): AI Vision OCR
 * - DOCX: mammoth text extraction
 * - CSV: papaparse structured parsing
 * - XLSX: exceljs structured parsing
 */
import { Worker, Job } from "bullmq";
import { eq } from "drizzle-orm";
import { readFileSync } from "fs";
import { createRedisConnection } from "../redis";
import { db } from "@/db";
import { fileUploads } from "@/db/schema/content";
import { contentPipelineLogs } from "@/db/schema/system";
import type { FileJobData } from "./index";

let worker: Worker<FileJobData> | null = null;

export function startFileWorker(): Worker<FileJobData> {
  if (worker) return worker;

  worker = new Worker<FileJobData>(
    "file",
    async (job: Job<FileJobData>) => {
      const { fileUploadId, action } = job.data;
      const startTime = Date.now();

      console.log(`[FileWorker] Processing file ${fileUploadId}, action: ${action}`);

      // Load file record
      const [upload] = await db
        .select()
        .from(fileUploads)
        .where(eq(fileUploads.id, fileUploadId))
        .limit(1);

      if (!upload) {
        throw new Error(`File upload ${fileUploadId} not found`);
      }

      // Update status to processing
      await db
        .update(fileUploads)
        .set({ processingStatus: "processing" })
        .where(eq(fileUploads.id, fileUploadId));

      try {
        if (action === "extract_text") {
          await handleExtractText(upload, fileUploadId, startTime);
        } else if (action === "process") {
          await handleProcessQuestions(upload, fileUploadId, startTime);
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`[FileWorker] Failed: ${errorMsg}`);

        await db
          .update(fileUploads)
          .set({ processingStatus: "failed" })
          .where(eq(fileUploads.id, fileUploadId));

        await logPipeline("file_processing", fileUploadId, "failed", {
          action,
          error: errorMsg,
        }, Date.now() - startTime);

        throw err;
      }
    },
    {
      connection: createRedisConnection(),
      concurrency: 3,
    }
  );

  worker.on("error", (err) => {
    console.error("[FileWorker] Worker error:", err.message);
  });

  console.log("[FileWorker] Started and waiting for jobs...");
  return worker;
}

/**
 * Extract text from uploaded file based on file type.
 * After extraction, enqueues the file for question parsing.
 */
async function handleExtractText(
  upload: typeof fileUploads.$inferSelect,
  fileUploadId: number,
  startTime: number
): Promise<void> {
  const filePath = upload.storageUrl;
  if (!filePath) throw new Error("No file path stored");

  const fileType = (upload.fileType ?? "").toLowerCase();
  const fileName = upload.fileName ?? "";
  const ext = "." + fileName.split(".").pop()?.toLowerCase();
  let extractedText = "";

  // Read file buffer
  const buffer = readFileSync(filePath);
  console.log(`[FileWorker] Read file: ${fileName} (${(buffer.length / 1024).toFixed(1)} KB)`);

  if (fileType.includes("pdf") || ext === ".pdf") {
    // PDF extraction
    const { extractTextFromPdf } = await import("../scraper/parser");
    try {
      extractedText = await extractTextFromPdf(buffer);
    } catch {
      extractedText = "";
    }

    // If text is too short, try OCR
    if (extractedText.trim().length < 200) {
      console.log("[FileWorker] PDF text too short, trying AI Vision OCR...");
      const { aiVision } = await import("../ai/provider");
      const visionResult = await aiVision(
        "Extract all text from this document image. Include all questions, options, marks, and any content exactly as it appears.",
        buffer.toString("base64"),
        "image/png"
      );
      extractedText = visionResult.content;
    }
  } else if (
    fileType.includes("image") ||
    [".jpg", ".jpeg", ".png", ".webp"].includes(ext)
  ) {
    // Image OCR via AI Vision
    const { aiVision } = await import("../ai/provider");
    const mediaType = fileType.includes("png")
      ? "image/png"
      : fileType.includes("webp")
        ? "image/webp"
        : "image/jpeg";

    const visionResult = await aiVision(
      "Extract all text from this image. Include all questions, options, marks, and content exactly as written.",
      buffer.toString("base64"),
      mediaType
    );
    extractedText = visionResult.content;
  } else if (
    fileType.includes("wordprocessingml") ||
    fileType.includes("msword") ||
    ext === ".docx"
  ) {
    // DOCX extraction
    const { extractTextFromDocx } = await import("../question-import/docx-parser");
    extractedText = await extractTextFromDocx(buffer);
  } else if (fileType.includes("csv") || ext === ".csv") {
    // CSV — store raw content, parsing happens in process step
    extractedText = buffer.toString("utf-8");
  } else if (
    fileType.includes("spreadsheetml") ||
    fileType.includes("excel") ||
    [".xlsx", ".xls"].includes(ext)
  ) {
    // Excel — convert to text representation for storage
    const { parseExcel } = await import("../question-import/csv-excel-parser");
    const result = await parseExcel(buffer);
    extractedText = JSON.stringify({
      headers: result.headers,
      rowCount: result.rows.length,
      mapping: result.mapping,
      parsed: result.parsed,
    });
  } else {
    throw new Error(`Unsupported file type: ${fileType} (${ext})`);
  }

  console.log(`[FileWorker] Extracted ${extractedText.length} chars from ${fileName}`);

  // Update file record with extracted text
  await db
    .update(fileUploads)
    .set({
      extractedText,
      processingStatus: "completed",
    })
    .where(eq(fileUploads.id, fileUploadId));

  await logPipeline("text_extraction", fileUploadId, "completed", {
    fileName,
    fileType,
    textLength: extractedText.length,
  }, Date.now() - startTime);

  // If this is a question paper context, auto-enqueue for question parsing
  if (upload.uploadContext === "question_paper" && extractedText.length > 50) {
    try {
      const { addFileJob } = await import("./index");
      await addFileJob({ fileUploadId, action: "process" });
      console.log(`[FileWorker] Enqueued question parsing for file ${fileUploadId}`);
    } catch (err) {
      console.error("[FileWorker] Failed to enqueue parsing:", err);
    }
  }
}

/**
 * Parse extracted text into individual questions using AI.
 */
async function handleProcessQuestions(
  upload: typeof fileUploads.$inferSelect,
  fileUploadId: number,
  startTime: number
): Promise<void> {
  const extractedText = upload.extractedText;
  if (!extractedText) throw new Error("No extracted text to process");

  const fileName = upload.fileName ?? "";
  const ext = "." + fileName.split(".").pop()?.toLowerCase();

  if (ext === ".csv" || ext === ".xlsx" || ext === ".xls") {
    // Structured data — parse directly without AI
    let parsedRows;

    if (ext === ".csv") {
      const { parseCsv } = await import("../question-import/csv-excel-parser");
      const result = parseCsv(extractedText);
      parsedRows = result.parsed;
    } else {
      // Excel — extractedText was stored as JSON in extract step
      const parsed = JSON.parse(extractedText);
      parsedRows = parsed.parsed;
    }

    if (parsedRows && parsedRows.length > 0) {
      console.log(`[FileWorker] Importing ${parsedRows.length} questions from spreadsheet`);

      // Store parsed rows as metadata for user review via bulk API
      const meta = (upload.metadata as Record<string, unknown>) ?? {};
      await db
        .update(fileUploads)
        .set({
          processingStatus: "completed",
          metadata: {
            ...meta,
            parsedQuestions: parsedRows,
            parsedCount: parsedRows.length,
            needsTopicAssignment: true,
          },
        })
        .where(eq(fileUploads.id, fileUploadId));
    }
  } else {
    // Unstructured text — use AI parser
    const { aiChat } = await import("../ai/provider");
    const {
      SYSTEM_PROMPT,
      buildUserPrompt,
      parseResponse,
      config: promptConfig,
    } = await import("../ai/prompts/question-paper-parser");

    const userPrompt = buildUserPrompt({
      pdfText: extractedText,
      boardCode: "CBSE", // Default, could be inferred from upload context
      grade: 10,
    });

    const aiResult = await aiChat(userPrompt, {
      systemPrompt: SYSTEM_PROMPT,
      temperature: promptConfig.temperature,
      maxTokens: promptConfig.maxTokens,
    });

    const parsed = parseResponse(aiResult.content);

    console.log(
      `[FileWorker] AI parsed ${parsed.questions.length} questions (${aiResult.inputTokens} in / ${aiResult.outputTokens} out)`
    );

    await logPipeline("ai_parse", fileUploadId, "completed", {
      fileName,
      questionCount: parsed.questions.length,
      inputTokens: aiResult.inputTokens,
      outputTokens: aiResult.outputTokens,
      costUsd: aiResult.costUsd,
    }, Date.now() - startTime, aiResult.model, aiResult.inputTokens + aiResult.outputTokens);

    // Store parsed questions in metadata for user review
    const meta = (upload.metadata as Record<string, unknown>) ?? {};
    await db
      .update(fileUploads)
      .set({
        processingStatus: "completed",
        metadata: {
          ...meta,
          parsedQuestions: parsed.questions,
          parsedCount: parsed.questions.length,
          paperInfo: {
            subjectName: parsed.subjectName,
            grade: parsed.grade,
            totalMarks: parsed.totalMarks,
            sections: parsed.sections,
          },
          needsTopicAssignment: true,
        },
      })
      .where(eq(fileUploads.id, fileUploadId));
  }

  await logPipeline("question_parsing", fileUploadId, "completed", {
    fileName,
  }, Date.now() - startTime);

  console.log(`[FileWorker] Question parsing completed for file ${fileUploadId}`);
}

async function logPipeline(
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
      entityType: "file_upload",
      entityId,
      status,
      outputData: data,
      processingTimeMs: processingTimeMs ?? null,
      aiModelUsed: aiModelUsed ?? null,
      aiTokensUsed: aiTokensUsed ?? null,
    });
  } catch {
    // Don't fail the worker if logging fails
  }
}

export async function stopFileWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
    console.log("[FileWorker] Stopped.");
  }
}
