// ---------------------------------------------------------------------------
// Image Store — saves PDF page images to local filesystem
// ---------------------------------------------------------------------------
// In production, replace with S3 upload via src/lib/s3.ts

import { mkdir } from "fs/promises";
import { join } from "path";
import { renderPdfPages } from "./pdf-renderer";
import type { PageImage } from "./types";

/**
 * Render all PDF pages as PNGs and save to disk.
 *
 * @param pdfPath  Path to the source PDF
 * @param contentItemId  Unique identifier used for the output directory
 * @param maxPages  Optional limit on pages to render
 * @returns Array of PageImage metadata
 */
export async function savePageImages(
  pdfPath: string,
  contentItemId: number | string,
  maxPages?: number
): Promise<PageImage[]> {
  const outputDir = getImageDir(contentItemId);
  await mkdir(outputDir, { recursive: true });

  const pages = await renderPdfPages(pdfPath, outputDir, maxPages);

  console.log(
    `[ImageStore] Saved ${pages.length} page images to ${outputDir}`
  );

  return pages;
}

/**
 * Get the directory path for a content item's rich images.
 */
export function getImageDir(contentItemId: number | string): string {
  return join(process.cwd(), "data", "uploads", "rich-content", String(contentItemId));
}

/**
 * Get the URL path for serving a page image via the API route.
 * Returns path relative to /api/rich-content/images/
 */
export function getImageUrl(contentItemId: number | string, pageNumber: number): string {
  return `/api/rich-content/images/${contentItemId}/page-${pageNumber}.png`;
}
