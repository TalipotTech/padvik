import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { fileUploads } from "@/db/schema/content";
import { creatorContent, creatorProfiles } from "@/db/schema/creators";
import { eq, sql } from "drizzle-orm";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { checkCreator } from "@/lib/check-creator";
import { aiVision } from "@/lib/ai/provider";

// ---------------------------------------------------------------------------
// POST /api/creators/content/upload-handwritten
// Upload multiple images, run OCR on each, combine extracted text as content body
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
    const language = (formData.get("language") as string) || "en";
    const boardId = formData.get("boardId") as string | null;
    const standardId = formData.get("standardId") as string | null;
    const subjectId = formData.get("subjectId") as string | null;
    const chapterId = formData.get("chapterId") as string | null;
    const topicId = formData.get("topicId") as string | null;
    const isPremium = formData.get("isPremium") === "true";

    if (!title || title.length < 2) {
      return NextResponse.json(
        { success: false, error: { code: "VALIDATION_ERROR", message: "Title is required (min 2 chars)" } },
        { status: 400 }
      );
    }

    // Collect all image files
    const files: File[] = [];
    for (const [key, value] of formData.entries()) {
      if (key === "images" && value instanceof File) {
        files.push(value);
      }
    }

    if (files.length === 0) {
      return NextResponse.json(
        { success: false, error: { code: "MISSING_FILES", message: "At least one image is required" } },
        { status: 400 }
      );
    }

    if (files.length > 10) {
      return NextResponse.json(
        { success: false, error: { code: "TOO_MANY_FILES", message: "Maximum 10 images per upload" } },
        { status: 400 }
      );
    }

    // Validate all files are images
    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    for (const file of files) {
      if (!allowedTypes.includes(file.type)) {
        return NextResponse.json(
          { success: false, error: { code: "INVALID_TYPE", message: `Only JPEG, PNG, WEBP, GIF images allowed. Got: ${file.type}` } },
          { status: 400 }
        );
      }
      if (file.size > 20 * 1024 * 1024) {
        return NextResponse.json(
          { success: false, error: { code: "TOO_LARGE", message: "Each image must be under 20MB" } },
          { status: 400 }
        );
      }
    }

    // Save all images and run OCR
    const imageUrls: string[] = [];
    const uploadIds: number[] = [];
    const extractedParts: string[] = [];
    let totalAiCost = 0;
    let aiModel = "";

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const buffer = Buffer.from(await file.arrayBuffer());
      const timestamp = Date.now();
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
      const fileName = `${timestamp}-page${i + 1}.${ext}`;
      const dirPath = join(process.cwd(), "data", "uploads", "creators", String(userId));
      if (!existsSync(dirPath)) mkdirSync(dirPath, { recursive: true });
      writeFileSync(join(dirPath, fileName), buffer);

      const storageKey = `data/uploads/creators/${userId}/${fileName}`;
      const imageUrl = `/api/uploads/creators/${userId}/${fileName}`;
      imageUrls.push(imageUrl);

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
        metadata: { pageNumber: i + 1, totalPages: files.length, originalName: file.name },
      }).returning();
      uploadIds.push(upload.id);

      // Run OCR via AI Vision
      try {
        const base64 = buffer.toString("base64");
        const mediaType = file.type as "image/png" | "image/jpeg" | "image/webp" | "image/gif";

        const langHint = language !== "en"
          ? ` The handwriting is likely in ${getLanguageName(language)}. Extract in that language, transliterating if needed.`
          : "";

        const result = await aiVision(
          `Extract all text from this handwritten note (page ${i + 1} of ${files.length}). Preserve the formatting, paragraphs, headings, and any mathematical formulas (use LaTeX notation). If there are diagrams, describe them briefly. Output in the same language as the handwriting. Use Markdown format.${langHint}`,
          base64,
          mediaType,
          { temperature: 0.1, maxTokens: 4096, language }
        );

        extractedParts.push(result.content);
        totalAiCost += result.costUsd;
        aiModel = result.model;

        // Update fileUploads
        await db.update(fileUploads)
          .set({ processingStatus: "completed", extractedText: result.content })
          .where(eq(fileUploads.id, upload.id));
      } catch (ocrErr) {
        extractedParts.push(`[OCR failed for page ${i + 1} — image saved]`);
        await db.update(fileUploads)
          .set({ processingStatus: "failed" })
          .where(eq(fileUploads.id, upload.id));
      }
    }

    // Combine extracted text from all pages
    const combinedBody = files.length === 1
      ? extractedParts[0]
      : extractedParts.map((text, i) => `## Page ${i + 1}\n\n${text}`).join("\n\n---\n\n");

    // Use first image as thumbnail
    const thumbnailUrl = imageUrls[0] || null;

    // Create creator_content record
    const [content] = await db.insert(creatorContent).values({
      creatorId: userId,
      contentType: "note",
      title,
      description: description ?? null,
      body: combinedBody,
      fileUploadId: uploadIds[0] ?? null,
      mediaUrl: imageUrls[0] ?? null,
      thumbnailUrl,
      boardId: boardId ? Number(boardId) : null,
      standardId: standardId ? Number(standardId) : null,
      subjectId: subjectId ? Number(subjectId) : null,
      chapterId: chapterId ? Number(chapterId) : null,
      topicId: topicId ? Number(topicId) : null,
      isPremium,
      language,
      reviewStatus: "pending",
      isPublished: false,
      metadata: {
        handwritten: true,
        imageUrls,
        imageUploadIds: uploadIds,
        pageCount: files.length,
        ocrModel: aiModel,
        ocrCostUsd: totalAiCost,
      },
    }).returning();

    // Increment creator's content count
    await db
      .update(creatorProfiles)
      .set({ contentCount: sql`${creatorProfiles.contentCount} + 1`, updatedAt: new Date() })
      .where(eq(creatorProfiles.userId, userId));

    return NextResponse.json({
      success: true,
      data: {
        ...content,
        imageUrls,
        ocrModel: aiModel,
        ocrCost: totalAiCost,
      },
    }, { status: 201 });
  } catch (err) {
    return NextResponse.json({
      success: false,
      error: { code: "UPLOAD_ERROR", message: err instanceof Error ? err.message : "Upload failed" },
    }, { status: 500 });
  }
}

function getLanguageName(code: string): string {
  const names: Record<string, string> = {
    hi: "Hindi",
    ml: "Malayalam",
    ta: "Tamil",
    te: "Telugu",
    kn: "Kannada",
    mr: "Marathi",
    gu: "Gujarati",
    bn: "Bengali",
    en: "English",
  };
  return names[code] || "English";
}
