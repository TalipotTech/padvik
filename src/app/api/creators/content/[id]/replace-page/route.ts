import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { fileUploads } from "@/db/schema/content";
import { creatorContent } from "@/db/schema/creators";
import { eq } from "drizzle-orm";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { checkCreator } from "@/lib/check-creator";
import { aiVision } from "@/lib/ai/provider";

// ---------------------------------------------------------------------------
// POST /api/creators/content/[id]/replace-page
// Replace a specific page image in handwritten content, re-OCR, update body
// Body: FormData with "image" (single file) and "pageIndex" (number)
// ---------------------------------------------------------------------------
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const creator = await checkCreator();
  if (!creator?.isCreator) {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Creator login required" } },
      { status: 401 }
    );
  }

  const { id } = await params;
  const contentId = Number(id);
  const userId = creator.userId;

  // Fetch existing content
  const [existing] = await db
    .select()
    .from(creatorContent)
    .where(eq(creatorContent.id, contentId))
    .limit(1);

  if (!existing || existing.creatorId !== userId) {
    return NextResponse.json(
      { success: false, error: { code: "NOT_FOUND", message: "Content not found" } },
      { status: 404 }
    );
  }

  try {
    const formData = await request.formData();
    const file = formData.get("image") as File | null;
    const pageIndexStr = formData.get("pageIndex") as string | null;
    const language = (formData.get("language") as string) || existing.language || "en";

    if (!file) {
      return NextResponse.json(
        { success: false, error: { code: "MISSING_FILE", message: "Image file required" } },
        { status: 400 }
      );
    }

    const pageIndex = Number(pageIndexStr);
    const meta = (existing.metadata as Record<string, unknown>) || {};
    const imageUrls: string[] = (meta.imageUrls as string[]) || [];

    if (isNaN(pageIndex) || pageIndex < 0 || pageIndex >= imageUrls.length) {
      return NextResponse.json(
        { success: false, error: { code: "INVALID_PAGE", message: `Invalid page index. Must be 0-${imageUrls.length - 1}` } },
        { status: 400 }
      );
    }

    // Save new image file
    const buffer = Buffer.from(await file.arrayBuffer());
    const timestamp = Date.now();
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
    const fileName = `${timestamp}-page${pageIndex + 1}-replaced.${ext}`;
    const dirPath = join(process.cwd(), "data", "uploads", "creators", String(userId));
    if (!existsSync(dirPath)) mkdirSync(dirPath, { recursive: true });
    writeFileSync(join(dirPath, fileName), buffer);

    const storageKey = `data/uploads/creators/${userId}/${fileName}`;
    const newImageUrl = `/api/uploads/creators/${userId}/${fileName}`;

    // Create fileUploads record
    const [upload] = await db.insert(fileUploads).values({
      userId,
      fileName: file.name,
      fileType: ext,
      fileSizeBytes: file.size,
      storageKey,
      storageUrl: newImageUrl,
      processingStatus: "processing",
      uploadContext: "creator_handwritten_replace",
      metadata: { contentId, pageIndex, originalName: file.name },
    }).returning();

    // Run OCR on the new image
    let extractedText = "";
    let aiModel = "";
    let aiCost = 0;
    try {
      const base64 = buffer.toString("base64");
      const mediaType = file.type as "image/png" | "image/jpeg" | "image/webp" | "image/gif";
      const langNames: Record<string, string> = { hi: "Hindi", ml: "Malayalam", ta: "Tamil", te: "Telugu", kn: "Kannada", mr: "Marathi" };
      const langHint = langNames[language] ? ` The handwriting is likely in ${langNames[language]}.` : "";

      const result = await aiVision(
        `Extract all text from this handwritten note (page ${pageIndex + 1}). Preserve formatting, headings, and math formulas (LaTeX). Describe diagrams briefly. Use Markdown.${langHint}`,
        base64,
        mediaType,
        { temperature: 0.1, maxTokens: 4096, language }
      );
      extractedText = result.content;
      aiModel = result.model;
      aiCost = result.costUsd;

      await db.update(fileUploads)
        .set({ processingStatus: "completed", extractedText })
        .where(eq(fileUploads.id, upload.id));
    } catch {
      extractedText = `[OCR failed for replacement page ${pageIndex + 1}]`;
      await db.update(fileUploads)
        .set({ processingStatus: "failed" })
        .where(eq(fileUploads.id, upload.id));
    }

    // Update imageUrls — replace at the specific index
    const updatedImageUrls = [...imageUrls];
    updatedImageUrls[pageIndex] = newImageUrl;

    // Update uploadIds if tracked
    const uploadIds: number[] = (meta.imageUploadIds as number[]) || [];
    const updatedUploadIds = [...uploadIds];
    if (updatedUploadIds.length > pageIndex) {
      updatedUploadIds[pageIndex] = upload.id;
    }

    // Rebuild body — split into pages, replace the target page text, reassemble
    const body = existing.body || "";
    const pageSections = body.split(/\n---\n/).map(s => s.trim()).filter(Boolean);

    // Build the replacement page section
    const newPageSection = `## Page ${pageIndex + 1}\n\n![Page ${pageIndex + 1}](${newImageUrl})\n\n${extractedText}`;

    // Replace or pad
    while (pageSections.length <= pageIndex) {
      pageSections.push("");
    }
    pageSections[pageIndex] = newPageSection;

    const updatedBody = pageSections.join("\n\n---\n\n");

    // Update content record
    const [updated] = await db
      .update(creatorContent)
      .set({
        body: updatedBody,
        metadata: {
          ...meta,
          imageUrls: updatedImageUrls,
          imageUploadIds: updatedUploadIds,
          ocrModel: aiModel || meta.ocrModel,
          ocrCostUsd: ((meta.ocrCostUsd as number) || 0) + aiCost,
        },
        updatedAt: new Date(),
      })
      .where(eq(creatorContent.id, contentId))
      .returning();

    return NextResponse.json({
      success: true,
      data: {
        ...updated,
        replacedPage: {
          pageIndex,
          imageUrl: newImageUrl,
          extractedText,
          ocrModel: aiModel,
        },
      },
    });
  } catch (err) {
    return NextResponse.json({
      success: false,
      error: { code: "REPLACE_ERROR", message: err instanceof Error ? err.message : "Failed" },
    }, { status: 500 });
  }
}
