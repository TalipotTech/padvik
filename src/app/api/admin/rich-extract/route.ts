import { NextRequest, NextResponse } from "next/server";
import { stat } from "fs/promises";
import { join } from "path";
import { z } from "zod/v4";
import { db } from "@/db";
import { contentItems } from "@/db/schema/content";
import { eq } from "drizzle-orm";
import { extractFromPdf, type RichExtractionResult } from "@/lib/document-parser";
import { getImageUrl } from "@/lib/document-parser";

const RequestSchema = z.object({
  pdfPath: z.string().min(1),
  topicId: z.number().int().positive(),
  title: z.string().optional(),
  language: z.string().default("en"),
  maxPages: z.number().int().positive().optional(),
});

/**
 * POST /api/admin/rich-extract
 * Trigger rich content extraction from a PDF and store as a content item.
 *
 * Body: { pdfPath, topicId, title?, language?, maxPages? }
 * Returns: { success, data: { contentItemId, result: RichExtractionResult } }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = RequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.message } },
        { status: 400 }
      );
    }

    const { pdfPath, topicId, title, language, maxPages } = parsed.data;

    // Verify the PDF file exists
    const fullPdfPath = join(process.cwd(), pdfPath);
    try {
      const fileStat = await stat(fullPdfPath);
      if (!fileStat.isFile()) {
        return NextResponse.json(
          { success: false, error: { code: "FILE_NOT_FOUND", message: `PDF not found: ${pdfPath}` } },
          { status: 404 }
        );
      }
    } catch {
      return NextResponse.json(
        { success: false, error: { code: "FILE_NOT_FOUND", message: `PDF not found: ${pdfPath}` } },
        { status: 404 }
      );
    }

    // Create a placeholder content item
    const [inserted] = await db
      .insert(contentItems)
      .values({
        topicId,
        contentType: "rich_note",
        title: title ?? `Rich content: ${pdfPath.split("/").pop()}`,
        body: "Extraction in progress...",
        bodyFormat: "structured",
        sourceType: "ncert_rich",
        sourceUrl: pdfPath,
        language,
        reviewStatus: "pending",
        metadata: { status: "extracting" },
      })
      .returning({ id: contentItems.id });

    const contentItemId = inserted.id;

    // Run extraction
    const result = await extractFromPdf(fullPdfPath, {
      contentItemId,
      language,
      maxPages,
    });

    // Patch image blocks with API-servable URLs
    for (const block of result.blocks) {
      if (block.type === "image" && block.imagePath) {
        // Convert filesystem path to API URL
        const match = block.imagePath.match(/rich-content\/([^/]+)\/page-(\d+)\.png/);
        if (match) {
          block.imagePath = getImageUrl(match[1], parseInt(match[2], 10));
        }
      }
    }

    // Update the content item with extracted data
    await db
      .update(contentItems)
      .set({
        body: result.markdownFallback,
        metadata: {
          richBlocks: result.blocks,
          pageImages: result.pageImages.map((p) => ({
            ...p,
            url: getImageUrl(contentItemId, p.pageNumber),
          })),
          extraction: result.metadata,
          status: "completed",
        },
        updatedAt: new Date(),
      })
      .where(eq(contentItems.id, contentItemId));

    return NextResponse.json({
      success: true,
      data: {
        contentItemId,
        blockCount: result.blocks.length,
        pageCount: result.pageImages.length,
        strategy: result.metadata.strategy,
        cost: result.metadata.costUsd,
        warnings: result.warnings,
      },
    });
  } catch (err) {
    console.error("[rich-extract] Extraction failed:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: { code: "EXTRACTION_FAILED", message } },
      { status: 500 }
    );
  }
}
