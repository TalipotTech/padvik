// ---------------------------------------------------------------------------
// PDF Page Renderer — converts PDF pages to PNG images
// ---------------------------------------------------------------------------

import { readFile, writeFile, mkdir } from "fs/promises";
import { join, dirname } from "path";
import type { PageImage } from "./types";

/**
 * Render all pages of a PDF to PNG images.
 * Uses pdf-to-img (wraps pdfjs-dist) for server-side rendering.
 *
 * @param pdfPath  Absolute or relative path to the PDF file
 * @param outputDir  Directory where page-N.png files will be written
 * @param maxPages  Optional limit on pages to render (default: all)
 * @returns Array of PageImage metadata for each rendered page
 */
export async function renderPdfPages(
  pdfPath: string,
  outputDir: string,
  maxPages?: number
): Promise<PageImage[]> {
  // pdf-to-img is ESM-only — exports { pdf }
  const { pdf } = await import("pdf-to-img");

  await mkdir(outputDir, { recursive: true });

  const pdfBuffer = await readFile(pdfPath);
  const pages: PageImage[] = [];
  let pageNum = 0;

  const doc = await pdf(pdfBuffer, {
    scale: 2.0, // 2x for clarity (results in ~1600px width for A4)
  });

  for await (const pageImage of doc) {
    pageNum++;
    if (maxPages && pageNum > maxPages) break;

    const fileName = `page-${pageNum}.png`;
    const filePath = join(outputDir, fileName);
    const buf = Buffer.from(pageImage);
    await writeFile(filePath, buf);

    const { width, height } = getPngDimensions(buf);

    // Compute relative path from project root
    const projectRoot = process.cwd();
    const relativePath = filePath
      .replace(projectRoot, "")
      .replace(/\\/g, "/")
      .replace(/^\//, "");

    pages.push({
      pageNumber: pageNum,
      relativePath,
      width,
      height,
    });
  }

  return pages;
}

/**
 * Render a single PDF page to a PNG buffer (for AI Vision calls).
 */
export async function renderSinglePage(
  pdfBuffer: Buffer,
  pageNumber: number
): Promise<Buffer> {
  const { pdf } = await import("pdf-to-img");

  let currentPage = 0;
  const doc = await pdf(pdfBuffer, { scale: 2.0 });

  for await (const pageImage of doc) {
    currentPage++;
    if (currentPage === pageNumber) {
      return Buffer.from(pageImage);
    }
  }

  throw new Error(`Page ${pageNumber} not found in PDF (has ${currentPage} pages)`);
}

/**
 * Count pages in a PDF without rendering.
 */
export async function countPdfPages(pdfBuffer: Buffer): Promise<number> {
  const { pdf: pdfFunc } = await import("pdf-to-img");
  let count = 0;
  const doc = await pdfFunc(pdfBuffer, { scale: 0.5 });
  for await (const _page of doc) {
    count++;
  }
  return count;
}

/**
 * Get PNG dimensions from the buffer header.
 * PNG files store width at byte 16 and height at byte 20 (big-endian uint32).
 */
export function getPngDimensions(buffer: Buffer): { width: number; height: number } {
  if (buffer.length < 24) return { width: 0, height: 0 };
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}
