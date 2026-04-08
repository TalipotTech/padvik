import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { userNotes, fileUploads } from "@/db/schema/content";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { aiVision } from "@/lib/ai/provider";

/**
 * POST /api/learn/notes/upload
 * Upload a photo of handwritten notes. AI extracts text via Vision.
 * Both the original image and extracted text are saved.
 */
export async function POST(request: NextRequest) {
  let userId: number | null = null;
  try { const s = await auth(); userId = s?.user?.id ? Number(s.user.id) : null; } catch { /* auth failed */ }
  if (!userId && process.env.NODE_ENV === "development") userId = 1;
  if (!userId) {
    return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Login required" } }, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const topicIdStr = formData.get("topicId") as string | null;

    if (!file || !topicIdStr) {
      return NextResponse.json({ success: false, error: { code: "MISSING_FIELDS", message: "file and topicId required" } }, { status: 400 });
    }

    const topicId = parseInt(topicIdStr, 10);
    if (isNaN(topicId)) {
      return NextResponse.json({ success: false, error: { code: "INVALID_TOPIC", message: "Invalid topicId" } }, { status: 400 });
    }

    // Validate file type
    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json({ success: false, error: { code: "INVALID_TYPE", message: "Only JPEG, PNG, WEBP, GIF images allowed" } }, { status: 400 });
    }

    // Max 10MB
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ success: false, error: { code: "TOO_LARGE", message: "Image must be under 10MB" } }, { status: 400 });
    }

    // Save file locally
    const buffer = Buffer.from(await file.arrayBuffer());
    const timestamp = Date.now();
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
    const fileName = `${timestamp}-note.${ext}`;
    const dirPath = join(process.cwd(), "data", "uploads", "notes", String(userId));
    if (!existsSync(dirPath)) mkdirSync(dirPath, { recursive: true });
    const filePath = join(dirPath, fileName);
    writeFileSync(filePath, buffer);

    const storageKey = `data/uploads/notes/${userId}/${fileName}`;
    const imageUrl = `/api/uploads/notes/${userId}/${fileName}`;

    // Create fileUploads record
    const [upload] = await db.insert(fileUploads).values({
      userId,
      fileName: file.name,
      fileType: file.type.split("/")[1] ?? "jpeg",
      fileSizeBytes: file.size,
      storageKey,
      storageUrl: imageUrl,
      processingStatus: "processing",
      uploadContext: "handwritten_note",
      metadata: { topicId, originalName: file.name },
    }).returning();

    // Process with AI Vision for text extraction
    let extractedText = "";
    let aiModel = "";
    let aiCost = 0;

    try {
      const base64 = buffer.toString("base64");
      const mediaType = file.type as "image/png" | "image/jpeg" | "image/webp" | "image/gif";

      const result = await aiVision(
        "Extract all text from this handwritten note. Preserve the formatting, paragraphs, headings, and any mathematical formulas (use LaTeX notation). If there are diagrams, describe them briefly. Output in the same language as the handwriting. Use Markdown format.",
        base64,
        mediaType,
        { temperature: 0.1, maxTokens: 4096 }
      );

      extractedText = result.content;
      aiModel = result.model;
      aiCost = result.costUsd;

      // Update fileUploads with extracted text
      await db.update(fileUploads)
        .set({ processingStatus: "completed", extractedText })
        .where(eq(fileUploads.id, upload.id));
    } catch (err) {
      extractedText = "[OCR processing failed — image saved]";
      await db.update(fileUploads)
        .set({ processingStatus: "failed" })
        .where(eq(fileUploads.id, upload.id));
    }

    // Create the user note
    const [note] = await db.insert(userNotes).values({
      userId,
      topicId,
      title: `Handwritten Note — ${new Date().toLocaleDateString()}`,
      body: extractedText,
      bodyFormat: "markdown",
      isPrivate: true,
      noteType: "handwritten",
      imageUrl,
      imageFileId: upload.id,
    }).returning();

    return NextResponse.json({
      success: true,
      data: {
        ...note,
        aiModel,
        aiCost,
      },
    }, { status: 201 });
  } catch (err) {
    return NextResponse.json({
      success: false,
      error: { code: "UPLOAD_ERROR", message: err instanceof Error ? err.message : "Upload failed" },
    }, { status: 500 });
  }
}
