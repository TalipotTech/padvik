import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { fileUploads } from "@/db/schema/content";
import { creatorContent } from "@/db/schema/creators";
import { eq } from "drizzle-orm";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { checkCreator } from "@/lib/check-creator";

// ---------------------------------------------------------------------------
// POST /api/creators/content/[id]/replace — Replace the file for a content item
// ---------------------------------------------------------------------------
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

  const { id } = await params;
  const contentId = Number(id);
  const userId = creator.userId;

  // Verify ownership
  const [existing] = await db
    .select({ creatorId: creatorContent.creatorId, contentType: creatorContent.contentType })
    .from(creatorContent)
    .where(eq(creatorContent.id, contentId))
    .limit(1);

  if (!existing) {
    return NextResponse.json(
      { success: false, error: { code: "NOT_FOUND", message: "Content not found" } },
      { status: 404 }
    );
  }
  if (existing.creatorId !== userId) {
    return NextResponse.json(
      { success: false, error: { code: "FORBIDDEN", message: "You can only edit your own content" } },
      { status: 403 }
    );
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json(
        { success: false, error: { code: "MISSING_FILE", message: "No file provided" } },
        { status: 400 }
      );
    }

    // Save file locally
    const buffer = Buffer.from(await file.arrayBuffer());
    const timestamp = Date.now();
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "bin";
    const fileName = `${timestamp}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const dirPath = join(process.cwd(), "data", "uploads", "creators", String(userId));
    if (!existsSync(dirPath)) mkdirSync(dirPath, { recursive: true });
    const filePath = join(dirPath, fileName);
    writeFileSync(filePath, buffer);

    const storageKey = `data/uploads/creators/${userId}/${fileName}`;
    const mediaUrl = `/api/uploads/creators/${userId}/${fileName}`;

    // Create new fileUploads record
    const [upload] = await db.insert(fileUploads).values({
      userId,
      fileName: file.name,
      fileType: ext,
      fileSizeBytes: file.size,
      storageKey,
      storageUrl: mediaUrl,
      processingStatus: "uploaded",
      uploadContext: "creator_content_replace",
      metadata: { contentId, originalName: file.name },
    }).returning();

    // Update the content record with the new file
    const [updated] = await db
      .update(creatorContent)
      .set({
        fileUploadId: upload.id,
        mediaUrl,
        updatedAt: new Date(),
      })
      .where(eq(creatorContent.id, contentId))
      .returning();

    return NextResponse.json({
      success: true,
      data: updated,
    });
  } catch (err) {
    return NextResponse.json({
      success: false,
      error: { code: "UPLOAD_ERROR", message: err instanceof Error ? err.message : "Upload failed" },
    }, { status: 500 });
  }
}
