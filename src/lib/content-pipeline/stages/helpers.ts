/**
 * Shared helpers for pipeline stages.
 */

import { readFile } from "fs/promises";
import { join } from "path";
import type { PipelineContext } from "../types";

// ---------------------------------------------------------------------------
// File buffer resolution (works for both local dev and S3 URLs)
// ---------------------------------------------------------------------------

/**
 * Get file contents as a Buffer from a storage URL.
 * - Local dev URLs (`/api/uploads/…`) are resolved to the filesystem
 * - S3/remote URLs are fetched via HTTP
 */
export async function getFileBuffer(url: string): Promise<Buffer> {
  if (url.startsWith("/api/uploads/")) {
    // Local filesystem — resolve to data/uploads/{key}
    const key = url.replace("/api/uploads/", "");
    const localPath = join(process.cwd(), "data", "uploads", key);
    return readFile(localPath);
  }

  // Remote URL (S3, CDN, etc.)
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Failed to fetch file: ${resp.status} ${resp.statusText} — ${url}`);
  }
  return Buffer.from(await resp.arrayBuffer());
}

// ---------------------------------------------------------------------------
// Analysis text builder — content-type-aware
// ---------------------------------------------------------------------------

/**
 * Build the text to send to AI for analysis, based on content type.
 * - document: uses extracted text from pipeline metadata
 * - note: uses body text directly
 * - video/audio: uses title + description only (no transcript yet)
 * - image: title + description
 */
export function buildAnalysisText(ctx: PipelineContext, maxChars = 3000): string {
  const { content } = ctx;
  const contentType = content.contentType;

  const parts: string[] = [content.title];

  if (content.description) {
    parts.push(content.description);
  }

  // For documents, prefer extracted text over body
  if (contentType === "document" && ctx.metadata.extractedText) {
    parts.push(String(ctx.metadata.extractedText).substring(0, maxChars));
  } else if (content.body) {
    parts.push(content.body.substring(0, maxChars));
  }

  return parts.filter(Boolean).join("\n\n");
}
