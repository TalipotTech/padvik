// ---------------------------------------------------------------------------
// Document Parser — orchestrator for rich content extraction
// ---------------------------------------------------------------------------
// Public API for the document-parser module.
// Zero imports from src/db/ or src/app/ — this module is reusable.

import { savePageImages } from "./image-store";
import { extractRichContent } from "./rich-extractor";
import type { RichExtractionResult, ExtractionOptions, PageImage } from "./types";

// Re-export all types
export type {
  RichContentBlock,
  RichExtractionResult,
  ExtractionOptions,
  ExtractionMetadata,
  PageImage,
  CalloutVariant,
  RichBlockType,
} from "./types";

// Re-export utilities
export { blocksToMarkdown } from "./rich-extractor";
export { getImageUrl, getImageDir, savePageImages } from "./image-store";
export { renderPdfPages, countPdfPages } from "./pdf-renderer";

/**
 * Full extraction pipeline: render page images + extract rich content via AI.
 *
 * @param pdfPath  Path to the source département PDF file
 * @param options  Extraction configuration
 * @returns RichExtractionResult with blocks, images, markdown fallback, and metadata
 *
 * @example
 * ```ts
 * const result = await extractFromPdf("data/ncert-pdfs/9/political-science/ch01.pdf", {
 *   contentItemId: 42,
 *   language: "en",
 * });
 * console.log(result.blocks.length, "blocks extracted");
 * console.log(result.pageImages.length, "page images saved");
 * ```
 */
export async function extractFromPdf(
  pdfPath: string,
  options: ExtractionOptions = {}
): Promise<RichExtractionResult> {
  const contentId = options.contentItemId ?? `test-${Date.now()}`;

  console.log(`[DocumentParser] Starting extraction: ${pdfPath}`);
  const start = Date.now();

  // Step 1: Render PDF pages as PNG images
  // pdf-to-img can fail on some systems (Skia surface errors, missing canvas, etc.)
  // If rendering fails, we still proceed with AI extraction but without page images
  let pageImages: PageImage[] = [];
  console.log("[DocumentParser] Step 1/2: Rendering page images...");
  try {
    pageImages = await savePageImages(pdfPath, contentId, options.maxPages);
    console.log(`[DocumentParser] Rendered ${pageImages.length} pages in ${Date.now() - start}ms`);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.warn(`[DocumentParser] Page rendering failed (${errMsg}), continuing with text-only extraction`);
    // Force text_only strategy since we have no page images for vision
    if (!options.forceStrategy) {
      options = { ...options, forceStrategy: "text_only" };
    }
  }

  // Step 2: Extract structured content via AI
  console.log("[DocumentParser] Step 2/2: Extracting content via AI...");
  const result = await extractRichContent(pdfPath, pageImages, options);

  const totalDuration = Date.now() - start;
  console.log(
    `[DocumentParser] Complete: ${result.blocks.length} blocks, ${pageImages.length} images, ` +
    `${result.metadata.strategy} strategy, ${totalDuration}ms total`
  );

  // Log block type distribution
  const typeCounts: Record<string, number> = {};
  for (const b of result.blocks) {
    typeCounts[b.type] = (typeCounts[b.type] ?? 0) + 1;
  }
  console.log("[DocumentParser] Block types:", typeCounts);

  return result;
}
