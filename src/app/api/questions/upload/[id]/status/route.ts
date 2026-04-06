import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { fileUploads } from "@/db/schema/content";
import { eq } from "drizzle-orm";

// ---------------------------------------------------------------------------
// GET /api/questions/upload/[id]/status — Poll processing status
// ---------------------------------------------------------------------------
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Login required" } },
      { status: 401 }
    );
  }

  const { id } = await params;
  const uploadId = Number(id);
  if (isNaN(uploadId)) {
    return NextResponse.json(
      { success: false, error: { code: "INVALID_ID", message: "Invalid upload ID" } },
      { status: 400 }
    );
  }

  const [upload] = await db
    .select()
    .from(fileUploads)
    .where(eq(fileUploads.id, uploadId))
    .limit(1);

  if (!upload) {
    return NextResponse.json(
      { success: false, error: { code: "NOT_FOUND", message: "Upload not found" } },
      { status: 404 }
    );
  }

  // Only the uploader or admin can check status
  const userId = Number(session.user.id);
  if (upload.userId !== userId && session.user.role !== "admin") {
    return NextResponse.json(
      { success: false, error: { code: "FORBIDDEN", message: "Access denied" } },
      { status: 403 }
    );
  }

  return NextResponse.json({
    success: true,
    data: {
      id: upload.id,
      fileName: upload.fileName,
      fileType: upload.fileType,
      processingStatus: upload.processingStatus,
      extractedContentIds: upload.extractedContentIds,
      metadata: upload.metadata,
    },
  });
}
