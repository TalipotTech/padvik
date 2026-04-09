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
// POST /api/creators/content/[id]/append-images
// Add images to existing content, run OCR, append extracted text to body
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

  // Verify ownership
  const [existing] = await db
    .select()
    .from(creatorContent)
    .where(eq(creatorContent.id, contentId))
    .limit(1);

  if (!existing || existing.creatorId !== userId) {
    return NextResponse.json(
      { success: false, error: { code: "NOT_FOUND", message: "Content not found or not yours" } },
      { status: 404 }
    );
  }

  try {
    const formData = await request.formData();
    const language = (formData.get("language") as string) || existing.language || "en";

    // Collect image files
    const files: File[] = [];
    for (const [key, value] of formData.entries()) {
      if (key === "images" && value instanceof File) {
        files.push(value);
      }
    }

    if (files.length === 0) {
      return NextResponse.json(
        { success: false, error: { code: "MISSING_FILES", message: "At least one image required" } },
        { status: 400 }
      );
    }

    // Existing metadata
    const meta = (existing.metadata as Record<string, unknown>) || {};
    const existingImageUrls: string[] = (meta.imageUrls as string[]) || [];
    const existingUploadIds: number[] = (meta.imageUploadIds as number[]) || [];
    const existingPageCount = (meta.pageCount as number) || existingImageUrls.length;

    const newImageUrls: string[] = [];
    const newUploadIds: number[] = [];
    const extractedParts: { text: string; imageUrl: string }[] = [];
    let totalAiCost = 0;
    let aiModel = "";

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const buffer = Buffer.from(await file.arrayBuffer());
      const timestamp = Date.now();
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
      const pageNum = existingPageCount + i + 1;
      const fileName = `${timestamp}-page${pageNum}.${ext}`;
      const dirPath = join(process.cwd(), "data", "uploads", "creators", String(userId));
      if (!existsSync(dirPath)) mkdirSync(dirPath, { recursive: true });
      writeFileSync(join(dirPath, fileName), buffer);

      const storageKey = `data/uploads/creators/${userId}/${fileName}`;
      const imageUrl = `/api/uploads/creators/${userId}/${fileName}`;
      newImageUrls.push(imageUrl);

      // Create fileUploads record
      const [upload] = await db.insert(fileUploads).values({
        userId,
        fileName: file.name,
        fileType: ext,
        fileSizeBytes: file.size,
        storageKey,
        storageUrl: imageUrl,
        processingStatus: "processing",
        uploadContext: "creator_handwritten",
        metadata: { contentId, pageNumber: pageNum, originalName: file.name },
      }).returning();
      newUploadIds.push(upload.id);

      // OCR
      try {
        const base64 = buffer.toString("base64");
        const mediaType = file.type as "image/png" | "image/jpeg" | "image/webp" | "image/gif";
        const langNames: Record<string, string> = { hi: "Hindi", ml: "Malayalam", ta: "Tamil", te: "Telugu", kn: "Kannada", mr: "Marathi" };
        const langHint = langNames[language] ? ` The handwriting is likely in ${langNames[language]}.` : "";

        const result = await aiVision(
          `Extract all text from this handwritten note (page ${pageNum}). Preserve formatting, headings, and math formulas (LaTeX). Describe diagrams briefly. Use Markdown.${langHint}`,
          base64,
          mediaType,
          { temperature: 0.1, maxTokens: 4096, language }
        );

        extractedParts.push({ text: result.content, imageUrl });
        totalAiCost += result.costUsd;
        aiModel = result.model;

        await db.update(fileUploads)
          .set({ processingStatus: "completed", extractedText: result.content })
          .where(eq(fileUploads.id, upload.id));
      } catch {
        extractedParts.push({ text: `[OCR failed for page ${pageNum}]`, imageUrl });
        await db.update(fileUploads)
          .set({ processingStatus: "failed" })
          .where(eq(fileUploads.id, upload.id));
      }
    }

    // Build new body — append extracted text to existing body
    const newTextBlock = extractedParts
      .map((p, i) => `## Page ${existingPageCount + i + 1}\n\n![Page ${existingPageCount + i + 1}](${p.imageUrl})\n\n${p.text}`)
      .join("\n\n---\n\n");

    const updatedBody = existing.body
      ? `${existing.body}\n\n---\n\n${newTextBlock}`
      : newTextBlock;

    // Merge metadata
    const allImageUrls = [...existingImageUrls, ...newImageUrls];
    const allUploadIds = [...existingUploadIds, ...newUploadIds];

    // Update content record
    const [updated] = await db
      .update(creatorContent)
      .set({
        body: updatedBody,
        thumbnailUrl: existing.thumbnailUrl || allImageUrls[0] || null,
        metadata: {
          ...meta,
          handwritten: true,
          imageUrls: allImageUrls,
          imageUploadIds: allUploadIds,
          pageCount: allImageUrls.length,
          ocrModel: aiModel || meta.ocrModel,
          ocrCostUsd: ((meta.ocrCostUsd as number) || 0) + totalAiCost,
        },
        updatedAt: new Date(),
      })
      .where(eq(creatorContent.id, contentId))
      .returning();

    return NextResponse.json({
      success: true,
      data: {
        ...updated,
        newPages: extractedParts,
        ocrModel: aiModel,
        ocrCost: totalAiCost,
      },
    });
  } catch (err) {
    return NextResponse.json({
      success: false,
      error: { code: "UPLOAD_ERROR", message: err instanceof Error ? err.message : "Failed" },
    }, { status: 500 });
  }
}
