/**
 * Pipeline stage: generate_thumbnail
 *
 * Generates a thumbnail image based on content type:
 * - VIDEO:    Purple gradient placeholder with play icon (no ffmpeg needed)
 * - DOCUMENT: Renders page 1 of PDF as PNG, resized to 400px width
 * - IMAGE:    Resizes original image to 400px width
 */

import sharp from "sharp";
import { uploadToStorage } from "@/lib/s3";
import type { PipelineContext } from "../types";
import { getFileBuffer } from "./helpers";

const THUMB_WIDTH = 400;

export async function handleGenerateThumbnail(ctx: PipelineContext): Promise<void> {
  const contentType = ctx.content.contentType;

  switch (contentType) {
    case "video":
      await generateVideoPlaceholder(ctx);
      break;
    case "document":
      await generateDocumentThumbnail(ctx);
      break;
    case "image":
      await generateImageThumbnail(ctx);
      break;
    default:
      // No thumbnail needed for other types
      break;
  }
}

// ---------------------------------------------------------------------------
// VIDEO — Purple gradient placeholder with play icon
// ---------------------------------------------------------------------------

async function generateVideoPlaceholder(ctx: PipelineContext): Promise<void> {
  const svg = `<svg width="400" height="225" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" style="stop-color:#7C3AED"/>
        <stop offset="100%" style="stop-color:#4F46E5"/>
      </linearGradient>
    </defs>
    <rect width="400" height="225" fill="url(#g)" rx="8"/>
    <circle cx="200" cy="112" r="32" fill="rgba(255,255,255,0.2)"/>
    <polygon points="190,95 190,130 218,112" fill="rgba(255,255,255,0.9)"/>
  </svg>`;

  const pngBuffer = await sharp(Buffer.from(svg)).png({ quality: 80 }).toBuffer();
  const key = `creators/${ctx.content.creatorId}/thumbs/${ctx.contentId}-video.png`;
  const url = await uploadToStorage(key, pngBuffer, "image/png");
  ctx.result.thumbnailUrl = url;
}

// ---------------------------------------------------------------------------
// DOCUMENT — Render page 1 as thumbnail
// ---------------------------------------------------------------------------

async function generateDocumentThumbnail(ctx: PipelineContext): Promise<void> {
  const mediaUrl = ctx.content.mediaUrl;
  if (!mediaUrl) return;

  try {
    const pdfBuffer = await getFileBuffer(mediaUrl);

    // Use existing pdf-renderer to render page 1
    const { renderSinglePage } = await import("@/lib/document-parser/pdf-renderer");
    const pageBuffer = await renderSinglePage(pdfBuffer, 1);

    // Resize to thumbnail width
    const thumbnail = await sharp(pageBuffer)
      .resize({ width: THUMB_WIDTH })
      .png({ quality: 80 })
      .toBuffer();

    const key = `creators/${ctx.content.creatorId}/thumbs/${ctx.contentId}-doc.png`;
    const url = await uploadToStorage(key, thumbnail, "image/png");
    ctx.result.thumbnailUrl = url;
  } catch (err) {
    // PDF rendering can fail — fall back to purple placeholder
    console.warn(
      `[pipeline] Document thumbnail failed for content ${ctx.contentId}, using placeholder:`,
      err instanceof Error ? err.message : err
    );
    await generateDocumentPlaceholder(ctx);
  }
}

/** Fallback placeholder for documents when page rendering fails */
async function generateDocumentPlaceholder(ctx: PipelineContext): Promise<void> {
  const svg = `<svg width="400" height="520" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" style="stop-color:#7C3AED"/>
        <stop offset="100%" style="stop-color:#6D28D9"/>
      </linearGradient>
    </defs>
    <rect width="400" height="520" fill="url(#g)" rx="8"/>
    <rect x="120" y="120" width="160" height="200" rx="8" fill="rgba(255,255,255,0.15)"/>
    <rect x="145" y="180" width="110" height="6" rx="3" fill="rgba(255,255,255,0.4)"/>
    <rect x="145" y="200" width="90" height="6" rx="3" fill="rgba(255,255,255,0.3)"/>
    <rect x="145" y="220" width="100" height="6" rx="3" fill="rgba(255,255,255,0.3)"/>
    <rect x="145" y="240" width="70" height="6" rx="3" fill="rgba(255,255,255,0.2)"/>
    <text x="200" y="400" text-anchor="middle" font-family="Arial, sans-serif" font-size="14" fill="rgba(255,255,255,0.6)">PDF Document</text>
  </svg>`;

  const pngBuffer = await sharp(Buffer.from(svg))
    .resize({ width: THUMB_WIDTH })
    .png({ quality: 80 })
    .toBuffer();

  const key = `creators/${ctx.content.creatorId}/thumbs/${ctx.contentId}-doc.png`;
  const url = await uploadToStorage(key, pngBuffer, "image/png");
  ctx.result.thumbnailUrl = url;
}

// ---------------------------------------------------------------------------
// IMAGE — Resize original to 400px width
// ---------------------------------------------------------------------------

async function generateImageThumbnail(ctx: PipelineContext): Promise<void> {
  const mediaUrl = ctx.content.mediaUrl;
  if (!mediaUrl) return;

  try {
    const imageBuffer = await getFileBuffer(mediaUrl);

    const thumbnail = await sharp(imageBuffer)
      .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
      .png({ quality: 80 })
      .toBuffer();

    const key = `creators/${ctx.content.creatorId}/thumbs/${ctx.contentId}-img.png`;
    const url = await uploadToStorage(key, thumbnail, "image/png");
    ctx.result.thumbnailUrl = url;
  } catch (err) {
    console.warn(
      `[pipeline] Image thumbnail failed for content ${ctx.contentId}:`,
      err instanceof Error ? err.message : err
    );
    // Leave thumbnailUrl as-is (upload route may have set it to the original image)
  }
}
