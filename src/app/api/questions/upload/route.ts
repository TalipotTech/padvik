import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { fileUploads } from "@/db/schema/content";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

const ALLOWED_EXTENSIONS = new Set([
  ".pdf", ".jpg", ".jpeg", ".png", ".webp",
  ".csv", ".xls", ".xlsx", ".docx",
]);

// ---------------------------------------------------------------------------
// POST /api/questions/upload — Upload a file for question extraction
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Login required" } },
      { status: 401 }
    );
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json(
      { success: false, error: { code: "NO_FILE", message: "No file uploaded" } },
      { status: 400 }
    );
  }

  // Validate file size
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { success: false, error: { code: "FILE_TOO_LARGE", message: "File must be under 20MB" } },
      { status: 400 }
    );
  }

  // Validate file type
  const ext = "." + file.name.split(".").pop()?.toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "INVALID_TYPE",
          message: `Unsupported file type. Allowed: ${[...ALLOWED_EXTENSIONS].join(", ")}`,
        },
      },
      { status: 400 }
    );
  }

  const userId = Number(session.user.id);

  // Save file locally (dev) — production would use S3
  const uploadDir = join(process.cwd(), "data", "uploads", "questions", String(userId));
  if (!existsSync(uploadDir)) {
    mkdirSync(uploadDir, { recursive: true });
  }

  const timestamp = Date.now();
  const safeFilename = `${timestamp}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  const filePath = join(uploadDir, safeFilename);
  const buffer = Buffer.from(await file.arrayBuffer());
  writeFileSync(filePath, buffer);

  // Create file upload record
  const [upload] = await db
    .insert(fileUploads)
    .values({
      userId,
      fileName: file.name,
      fileType: file.type || ext,
      fileSizeBytes: file.size,
      storageKey: `questions/${userId}/${safeFilename}`,
      storageUrl: filePath,
      processingStatus: "uploaded",
      uploadContext: "question_paper",
      metadata: {
        originalName: file.name,
        uploadedAt: new Date().toISOString(),
      },
    })
    .returning();

  // Enqueue for processing
  try {
    const { addFileJob } = await import("@/lib/queue");
    await addFileJob({
      fileUploadId: upload.id,
      action: "extract_text",
    });
  } catch (err) {
    // If queue is unavailable, still return the upload record
    console.error("[Upload] Failed to enqueue file job:", err);
  }

  return NextResponse.json(
    {
      success: true,
      data: {
        id: upload.id,
        fileName: upload.fileName,
        fileType: upload.fileType,
        processingStatus: upload.processingStatus,
      },
    },
    { status: 201 }
  );
}
