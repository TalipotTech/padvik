import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { creatorContent } from "@/db/schema/creators";
import { eq } from "drizzle-orm";

// ---------------------------------------------------------------------------
// POST /api/creators/content/[id]/publish — Toggle publish status
// ---------------------------------------------------------------------------
export async function POST(
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
  const contentId = Number(id);
  const userId = Number(session.user.id);

  const [existing] = await db
    .select({
      creatorId: creatorContent.creatorId,
      isPublished: creatorContent.isPublished,
      reviewStatus: creatorContent.reviewStatus,
    })
    .from(creatorContent)
    .where(eq(creatorContent.id, contentId))
    .limit(1);

  if (!existing) {
    return NextResponse.json(
      { success: false, error: { code: "NOT_FOUND", message: "Content not found" } },
      { status: 404 }
    );
  }

  if (existing.creatorId !== userId && session.user.role !== "admin") {
    return NextResponse.json(
      { success: false, error: { code: "FORBIDDEN", message: "You can only publish your own content" } },
      { status: 403 }
    );
  }

  // Auto-approve for now during MVP; later require reviewStatus === "approved"
  const newPublished = !existing.isPublished;

  const [updated] = await db
    .update(creatorContent)
    .set({
      isPublished: newPublished,
      publishedAt: newPublished ? new Date() : null,
      reviewStatus: newPublished ? "approved" : existing.reviewStatus,
      updatedAt: new Date(),
    })
    .where(eq(creatorContent.id, contentId))
    .returning();

  return NextResponse.json({ success: true, data: updated });
}
