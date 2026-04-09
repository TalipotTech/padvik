import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { fileUploads } from "@/db/schema/content";
import { creatorContent } from "@/db/schema/creators";
import { eq } from "drizzle-orm";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { checkCreator } from "@/lib/check-creator";
import { aiVision } from "@/lib/ai/provider";
import {
  type MediaItem,
  validateFile,
  detectMediaType,
  dominantContentType,
  primaryMediaUrl,
  primaryFileUploadId,
  synthesizeFromLegacy,
} from "@/lib/media-items";

export const maxDuration = 300;

// ---------------------------------------------------------------------------
// POST /api/creators/content/[id]/add-media
// Add one or more files (any type) to existing content
// FormData: files (multiple), handwritten? ("true"), language?
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

  const [existing] = await db.select().from(creatorContent).where(eq(creatorContent.id, contentId)).limit(1);
  if (!existing || existing.creatorId !== userId) {
    return NextResponse.json(
      { success: false, error: { code: "NOT_FOUND", message: "Content not found" } },
      { status: 404 }
    );
  }

  try {
    const formData = await request.formData();
    const handwritten = formData.get("handwritten") === "true";
    const language = (formData.get("language") as string) || existing.language || "en";

    // Collect files
    const files: File[] = [];
    for (const [key, value] of formData.entries()) {
      if (key === "files" && value instanceof File) files.push(value);
    }
    if (files.length === 0) {
      return NextResponse.json(
        { success: false, error: { code: "MISSING_FILES", message: "At least one file required" } },
        { status: 400 }
      );
    }

    // Validate all files
    for (const file of files) {
      const result = validateFile(file);
      if (typeof result === "string") {
        return NextResponse.json(
          { success: false, error: { code: "INVALID_FILE", message: result } },
          { status: 400 }
        );
      }
    }

    // Get existing media items (or synthesize from legacy)
    const meta = (existing.metadata as Record<string, unknown>) || {};
    let existingItems: MediaItem[] = (meta.mediaItems as MediaItem[]) || [];
    if (existingItems.length === 0 && (meta.imageUrls as string[])?.length) {
      existingItems = synthesizeFromLegacy(meta);
    }
    const maxOrder = existingItems.length > 0 ? Math.max(...existingItems.map(i => i.order)) : -1;

    const newItems: MediaItem[] = [];
    const ocrTexts: string[] = [];
    let totalOcrCost = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const buffer = Buffer.from(await file.arrayBuffer());
      const timestamp = Date.now();
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "bin";
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const fileName = `${timestamp}-${safeName}`;
      const dirPath = join(process.cwd(), "data", "uploads", "creators", String(userId));
      if (!existsSync(dirPath)) mkdirSync(dirPath, { recursive: true });
      writeFileSync(join(dirPath, fileName), buffer);

      const storageKey = `data/uploads/creators/${userId}/${fileName}`;
      const mediaUrl = `/api/uploads/creators/${userId}/${fileName}`;
      const mediaType = detectMediaType(file.type);

      const [upload] = await db.insert(fileUploads).values({
        userId,
        fileName: file.name,
        fileType: ext,
        fileSizeBytes: file.size,
        storageKey,
        storageUrl: mediaUrl,
        processingStatus: "uploaded",
        uploadContext: "creator_content",
        metadata: { contentId, originalName: file.name },
      }).returning();

      const item: MediaItem = {
        type: mediaType || "document",
        url: mediaUrl,
        fileUploadId: upload.id,
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type,
        order: maxOrder + 1 + i,
      };

      // OCR for images if handwritten
      if (handwritten && mediaType === "image") {
        try {
          const base64 = buffer.toString("base64");
          const mt = file.type as "image/png" | "image/jpeg" | "image/webp" | "image/gif";
          const langNames: Record<string, string> = { hi: "Hindi", ml: "Malayalam", ta: "Tamil", te: "Telugu", kn: "Kannada" };
          const hint = langNames[language] ? ` The handwriting is likely in ${langNames[language]}.` : "";

          const result = await aiVision(
            `Extract all text from this handwritten note. Preserve formatting, headings, math formulas (LaTeX). Describe diagrams briefly. Markdown format.${hint}`,
            base64, mt,
            { temperature: 0.1, maxTokens: 4096, language }
          );
          item.extractedText = result.content;
          totalOcrCost += result.costUsd;
          ocrTexts.push(result.content);

          await db.update(fileUploads)
            .set({ processingStatus: "completed", extractedText: result.content })
            .where(eq(fileUploads.id, upload.id));
        } catch {
          item.extractedText = "[OCR failed]";
          ocrTexts.push("[OCR failed]");
          await db.update(fileUploads)
            .set({ processingStatus: "failed" })
            .where(eq(fileUploads.id, upload.id));
        }
      }

      newItems.push(item);
    }

    // Merge items
    const allItems = [...existingItems, ...newItems];

    // Append OCR text to body
    let updatedBody = existing.body || "";
    if (ocrTexts.length > 0) {
      const newTextBlock = ocrTexts.map((t, i) => {
        const imgItem = newItems.filter(it => it.type === "image")[i];
        const imgRef = imgItem ? `\n\n![Image](${imgItem.url})` : "";
        return `${imgRef}\n\n${t}`;
      }).join("\n\n---\n\n");
      updatedBody = updatedBody ? `${updatedBody}\n\n---\n\n${newTextBlock}` : newTextBlock;
    }

    // Update content
    const [updated] = await db.update(creatorContent).set({
      body: updatedBody || existing.body,
      mediaUrl: primaryMediaUrl(allItems) || existing.mediaUrl,
      fileUploadId: primaryFileUploadId(allItems) || existing.fileUploadId,
      contentType: dominantContentType(allItems, !!updatedBody),
      thumbnailUrl: existing.thumbnailUrl || allItems.find(i => i.type === "image")?.url || null,
      metadata: {
        ...meta,
        mediaItems: allItems,
        handwritten: meta.handwritten || (handwritten && newItems.some(i => i.type === "image")),
        // Keep legacy fields for backward compat
        imageUrls: allItems.filter(i => i.type === "image").map(i => i.url),
        imageUploadIds: allItems.filter(i => i.type === "image").map(i => i.fileUploadId),
        pageCount: allItems.filter(i => i.type === "image").length,
      },
      updatedAt: new Date(),
    }).where(eq(creatorContent.id, contentId)).returning();

    return NextResponse.json({ success: true, data: updated });
  } catch (err) {
    return NextResponse.json({
      success: false,
      error: { code: "UPLOAD_ERROR", message: err instanceof Error ? err.message : "Failed" },
    }, { status: 500 });
  }
}
