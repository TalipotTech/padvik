import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

import { db } from "@/db";
import { fileUploads } from "@/db/schema/content";
import { creatorContent, creatorProfiles } from "@/db/schema/creators";
import { eq, sql } from "drizzle-orm";
import { checkCreator } from "@/lib/check-creator";
import { uploadToStorage, generateStorageKey } from "@/lib/s3";
import { aiVision, type AIModel } from "@/lib/ai/provider";
import {
  type MediaItem,
  validateFile,
  detectMediaType,
  dominantContentType,
  primaryMediaUrl,
  primaryFileUploadId,
} from "@/lib/media-items";
import {
  buildOcrPrompt,
  parseOcrBlocks,
  blocksToMarkdown,
  blocksToPlainText,
  type OcrBlock,
} from "@/lib/content-pipeline/ocr-blocks";

// ---------------------------------------------------------------------------
// POST /api/creators/content/upload
// Accept multiple files of any type + optional text body
// FormData: files (multiple), title, description, body?, handwritten?,
//           boardId?, standardId?, subjectId?, chapterId?, topicId?,
//           language?, isPremium?
// Backward compat: also accepts single "file" field
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest) {
  const creator = await checkCreator();
  if (!creator) {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Login required" } },
      { status: 401 }
    );
  }
  if (!creator.isCreator) {
    return NextResponse.json(
      { success: false, error: { code: "FORBIDDEN", message: "Creator account required" } },
      { status: 403 }
    );
  }

  const userId = creator.userId;

  try {
    const formData = await request.formData();
    const title = formData.get("title") as string | null;
    const description = formData.get("description") as string | null;
    const body = formData.get("body") as string | null;
    const handwritten = formData.get("handwritten") === "true";
    const selectedOcrModel = (formData.get("ocrModel") as string) || undefined;
    const boardId = formData.get("boardId") as string | null;
    const standardId = formData.get("standardId") as string | null;
    const subjectId = formData.get("subjectId") as string | null;
    const chapterId = formData.get("chapterId") as string | null;
    const topicId = formData.get("topicId") as string | null;
    const language = (formData.get("language") as string) || "en";
    const isPremium = formData.get("isPremium") === "true";

    if (!title || title.length < 2) {
      return NextResponse.json(
        { success: false, error: { code: "VALIDATION_ERROR", message: "Title is required (min 2 chars)" } },
        { status: 400 }
      );
    }

    // Collect files — support both "files" (multi) and "file" (legacy single)
    const files: File[] = [];
    for (const [key, value] of formData.entries()) {
      if ((key === "files" || key === "file") && value instanceof File && value.size > 0) {
        files.push(value);
      }
    }

    if (files.length > 20) {
      return NextResponse.json(
        { success: false, error: { code: "TOO_MANY_FILES", message: "Maximum 20 files per upload" } },
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

    // Process each file
    const mediaItems: MediaItem[] = [];
    const ocrTexts: string[] = [];
    const allOcrBlocks: OcrBlock[][] = []; // structured blocks per image
    let totalOcrCost = 0;
    let ocrModel = "";

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const buffer = Buffer.from(await file.arrayBuffer());
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "bin";

      // Upload to S3 or local filesystem
      const storageKey = generateStorageKey(userId, file.name);
      const mediaUrl = await uploadToStorage(storageKey, buffer, file.type);
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
        metadata: { originalName: file.name },
      }).returning();

      const item: MediaItem = {
        type: mediaType || "document",
        url: mediaUrl,
        fileUploadId: upload.id,
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type,
        order: i,
      };

      // OCR for images if handwritten flag — structured block extraction
      if (handwritten && mediaType === "image") {
        try {
          const base64 = buffer.toString("base64");
          const mt = file.type as "image/png" | "image/jpeg" | "image/webp" | "image/gif";
          const langNames: Record<string, string> = { hi: "Hindi", ml: "Malayalam", ta: "Tamil", te: "Telugu", kn: "Kannada" };
          const langHint = langNames[language] || undefined;

          const ocrPrompt = buildOcrPrompt(langHint);
          const result = await aiVision(
            ocrPrompt,
            base64, mt,
            {
              temperature: 0,           // deterministic output for OCR accuracy
              maxTokens: 8192,          // full educational response without truncation
              language,
              ...(selectedOcrModel ? { model: selectedOcrModel as AIModel } : {}),
            }
          );

          // Parse structured blocks from AI response
          const blocks = parseOcrBlocks(result.content);
          const markdown = blocksToMarkdown(blocks);
          const plainText = blocksToPlainText(blocks);

          item.extractedText = markdown; // markdown for rendering
          item.extractedBlocks = blocks; // structured blocks for RichContentViewer
          totalOcrCost += result.costUsd;
          ocrModel = result.model;
          ocrTexts.push(markdown);
          allOcrBlocks.push(blocks);

          // Store plain text in fileUploads for search indexing
          await db.update(fileUploads)
            .set({ processingStatus: "completed", extractedText: plainText })
            .where(eq(fileUploads.id, upload.id));
        } catch {
          item.extractedText = "[OCR failed]";
          ocrTexts.push("[OCR failed]");
          allOcrBlocks.push([{ type: "text", content: "[OCR failed]" }]);
          await db.update(fileUploads)
            .set({ processingStatus: "failed" })
            .where(eq(fileUploads.id, upload.id));
        }
      }

      mediaItems.push(item);
    }

    // Build body: user text + OCR results (markdown for search/AI pipeline)
    let combinedBody = body || "";
    if (ocrTexts.length > 0) {
      const ocrBlock = ocrTexts.map((t, i) => {
        const imgItem = mediaItems.filter(m => m.type === "image")[i];
        const imgRef = imgItem ? `![Image](${imgItem.url})\n\n` : "";
        return `${imgRef}${t}`;
      }).join("\n\n---\n\n");
      combinedBody = combinedBody ? `${combinedBody}\n\n---\n\n${ocrBlock}` : ocrBlock;
    }

    let contentType = dominantContentType(mediaItems, !!combinedBody);

    // Override: standalone non-handwritten images get the "image" pipeline
    // instead of being treated as notes
    if (
      contentType === "note" &&
      !handwritten &&
      mediaItems.length > 0 &&
      mediaItems.every((i) => i.type === "image") &&
      !combinedBody
    ) {
      contentType = "image";
    }

    const pMediaUrl = primaryMediaUrl(mediaItems);
    const pFileUploadId = primaryFileUploadId(mediaItems);

    // Collect original file info from the first (primary) file
    const primaryFile = files[0];

    const [content] = await db.insert(creatorContent).values({
      creatorId: userId,
      contentType,
      title,
      description: description ?? null,
      body: combinedBody || null,
      fileUploadId: pFileUploadId,
      mediaUrl: pMediaUrl,
      thumbnailUrl: mediaItems.find(i => i.type === "image")?.url || null,
      boardId: boardId ? Number(boardId) : null,
      standardId: standardId ? Number(standardId) : null,
      subjectId: subjectId ? Number(subjectId) : null,
      chapterId: chapterId ? Number(chapterId) : null,
      topicId: topicId ? Number(topicId) : null,
      isPremium,
      language,
      reviewStatus: "pending",
      isPublished: false,
      // New pipeline columns
      originalFileName: primaryFile?.name ?? null,
      originalFileType: primaryFile?.type ?? null,
      originalFileSizeBytes: primaryFile?.size ?? null,
      uploadStatus: mediaItems.length > 0 ? "processing" : "completed",
      metadata: {
        mediaItems,
        handwritten: handwritten && mediaItems.some(i => i.type === "image"),
        imageUrls: mediaItems.filter(i => i.type === "image").map(i => i.url),
        imageUploadIds: mediaItems.filter(i => i.type === "image").map(i => i.fileUploadId),
        pageCount: mediaItems.filter(i => i.type === "image").length,
        ocrModel: ocrModel || undefined,
        ocrCostUsd: totalOcrCost || undefined,
        // Structured OCR blocks (for rich rendering of tables, formulas, diagrams)
        ocrBlocks: allOcrBlocks.length > 0 ? allOcrBlocks : undefined,
        // Pipeline tracking — initialized for stage-based processing
        pipelineStage: null,
        pipelineCompletedStages: [],
      },
    }).returning();

    // Increment creator's content count
    await db.update(creatorProfiles)
      .set({ contentCount: sql`${creatorProfiles.contentCount} + 1`, updatedAt: new Date() })
      .where(eq(creatorProfiles.userId, userId));

    // Queue async AI processing (summarize, tag, quality check)
    try {
      const { addCreatorContentJob } = await import("@/lib/queue/index");
      await addCreatorContentJob({
        contentId: content.id,
        creatorId: userId,
        action: "process_full",
      });
    } catch {
      // Queue not available (Redis down) — content still saved, processing skipped
      await db.update(creatorContent)
        .set({ uploadStatus: "completed" })
        .where(eq(creatorContent.id, content.id));
    }

    return NextResponse.json({ success: true, data: content }, { status: 201 });
  } catch (err) {
    return NextResponse.json({
      success: false,
      error: { code: "UPLOAD_ERROR", message: err instanceof Error ? err.message : "Upload failed" },
    }, { status: 500 });
  }
}
