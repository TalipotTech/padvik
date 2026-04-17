/**
 * Pipeline stage: extract_text
 *
 * Extracts raw text from document files for AI analysis and search.
 * - PDF:  uses pdf-parse for text extraction
 * - DOCX: uses mammoth for text extraction
 * Stores first 10000 chars in metadata.extractedText
 */

import type { PipelineContext } from "../types";
import { getFileBuffer } from "./helpers";

const MAX_EXTRACTED_CHARS = 10_000;

export async function handleExtractText(ctx: PipelineContext): Promise<void> {
  const mediaUrl = ctx.content.mediaUrl;
  if (!mediaUrl) return;

  const mimeType = ctx.content.originalFileType ?? "";
  const fileName = ctx.content.originalFileName ?? "";

  let text = "";

  try {
    const buffer = await getFileBuffer(mediaUrl);

    if (isPdf(mimeType, fileName)) {
      text = await extractPdfText(buffer);
    } else if (isDocx(mimeType, fileName)) {
      text = await extractDocxText(buffer);
    }
  } catch (err) {
    console.warn(
      `[pipeline] Text extraction failed for content ${ctx.contentId}:`,
      err instanceof Error ? err.message : err
    );
    // Non-fatal — pipeline continues without extracted text
  }

  if (text) {
    const trimmed = text.substring(0, MAX_EXTRACTED_CHARS);
    ctx.metadata.extractedText = trimmed;
    ctx.result.extractedText = trimmed;
  }
}

// ---------------------------------------------------------------------------
// PDF text extraction
// ---------------------------------------------------------------------------

async function extractPdfText(buffer: Buffer): Promise<string> {
  // pdf-parse is a CommonJS module without type declarations
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pdfParse = require("pdf-parse") as (buf: Buffer) => Promise<{ text: string }>;
  const result = await pdfParse(buffer);
  return result.text?.trim() ?? "";
}

// ---------------------------------------------------------------------------
// DOCX text extraction
// ---------------------------------------------------------------------------

async function extractDocxText(buffer: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  return result.value?.trim() ?? "";
}

// ---------------------------------------------------------------------------
// MIME helpers
// ---------------------------------------------------------------------------

function isPdf(mime: string, fileName: string): boolean {
  return mime === "application/pdf" || fileName.toLowerCase().endsWith(".pdf");
}

function isDocx(mime: string, fileName: string): boolean {
  return (
    mime === "application/msword" ||
    mime.includes("wordprocessingml") ||
    fileName.toLowerCase().endsWith(".docx") ||
    fileName.toLowerCase().endsWith(".doc")
  );
}
