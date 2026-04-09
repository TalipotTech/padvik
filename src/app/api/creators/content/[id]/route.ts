import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { creatorContent, creatorProfiles } from "@/db/schema/creators";
import { boards, standards, subjects, chapters, topics } from "@/db/schema/curriculum";
import { eq, and, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { synthesizeFromLegacy, type MediaItem } from "@/lib/media-items";

// ---------------------------------------------------------------------------
// GET /api/creators/content/[id] — Get single content item with curriculum info
// ---------------------------------------------------------------------------
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const contentId = Number(id);
  if (isNaN(contentId)) {
    return NextResponse.json(
      { success: false, error: { code: "VALIDATION_ERROR", message: "Invalid content ID" } },
      { status: 400 }
    );
  }

  const session = await auth();
  const userId = session ? Number(session.user.id) : null;

  const [item] = await db
    .select({
      id: creatorContent.id,
      creatorId: creatorContent.creatorId,
      contentType: creatorContent.contentType,
      title: creatorContent.title,
      description: creatorContent.description,
      body: creatorContent.body,
      fileUploadId: creatorContent.fileUploadId,
      mediaUrl: creatorContent.mediaUrl,
      thumbnailUrl: creatorContent.thumbnailUrl,
      durationSeconds: creatorContent.durationSeconds,
      boardId: creatorContent.boardId,
      standardId: creatorContent.standardId,
      subjectId: creatorContent.subjectId,
      chapterId: creatorContent.chapterId,
      topicId: creatorContent.topicId,
      isPremium: creatorContent.isPremium,
      price: creatorContent.price,
      language: creatorContent.language,
      viewCount: creatorContent.viewCount,
      likeCount: creatorContent.likeCount,
      shareCount: creatorContent.shareCount,
      avgRating: creatorContent.avgRating,
      reviewStatus: creatorContent.reviewStatus,
      isPublished: creatorContent.isPublished,
      publishedAt: creatorContent.publishedAt,
      metadata: creatorContent.metadata,
      createdAt: creatorContent.createdAt,
      updatedAt: creatorContent.updatedAt,
      // Curriculum names
      boardName: boards.name,
      boardCode: boards.code,
      standardGrade: standards.grade,
      subjectName: subjects.name,
      chapterTitle: chapters.title,
      chapterNumber: chapters.chapterNumber,
      topicTitle: topics.title,
    })
    .from(creatorContent)
    .leftJoin(boards, eq(boards.id, creatorContent.boardId))
    .leftJoin(standards, eq(standards.id, creatorContent.standardId))
    .leftJoin(subjects, eq(subjects.id, creatorContent.subjectId))
    .leftJoin(chapters, eq(chapters.id, creatorContent.chapterId))
    .leftJoin(topics, eq(topics.id, creatorContent.topicId))
    .where(eq(creatorContent.id, contentId))
    .limit(1);

  if (!item) {
    return NextResponse.json(
      { success: false, error: { code: "NOT_FOUND", message: "Content not found" } },
      { status: 404 }
    );
  }

  // Non-owner can only see published content
  if (item.creatorId !== userId && !item.isPublished) {
    return NextResponse.json(
      { success: false, error: { code: "NOT_FOUND", message: "Content not found" } },
      { status: 404 }
    );
  }

  // Synthesize mediaItems for legacy content that only has imageUrls
  const meta = (item.metadata as Record<string, unknown>) || {};
  let mediaItems: MediaItem[] = (meta.mediaItems as MediaItem[]) || [];
  if (mediaItems.length === 0 && (meta.imageUrls as string[])?.length) {
    mediaItems = synthesizeFromLegacy(meta);
  }

  return NextResponse.json({
    success: true,
    data: { ...item, mediaItems },
  });
}

// ---------------------------------------------------------------------------
// PUT /api/creators/content/[id] — Update content metadata
// ---------------------------------------------------------------------------
const updateSchema = z.object({
  title: z.string().min(2).max(500).optional(),
  description: z.string().max(5000).optional(),
  body: z.string().optional(),
  boardId: z.number().optional().nullable(),
  standardId: z.number().optional().nullable(),
  subjectId: z.number().optional().nullable(),
  chapterId: z.number().optional().nullable(),
  topicId: z.number().optional().nullable(),
  isPremium: z.boolean().optional(),
  price: z.string().optional().nullable(),
  language: z.string().max(10).optional(),
});

export async function PUT(
  request: NextRequest,
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

  // Ownership check
  const [existing] = await db
    .select({ creatorId: creatorContent.creatorId })
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
      { success: false, error: { code: "FORBIDDEN", message: "You can only edit your own content" } },
      { status: 403 }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "INVALID_JSON", message: "Invalid JSON body" } },
      { status: 400 }
    );
  }

  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } },
      { status: 400 }
    );
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  for (const [key, value] of Object.entries(parsed.data)) {
    if (value !== undefined) {
      updates[key] = value;
    }
  }

  const [updated] = await db
    .update(creatorContent)
    .set(updates)
    .where(eq(creatorContent.id, contentId))
    .returning();

  return NextResponse.json({ success: true, data: updated });
}

// ---------------------------------------------------------------------------
// DELETE /api/creators/content/[id] — Delete content
// ---------------------------------------------------------------------------
export async function DELETE(
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
    .select({ creatorId: creatorContent.creatorId })
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
      { success: false, error: { code: "FORBIDDEN", message: "You can only delete your own content" } },
      { status: 403 }
    );
  }

  await db.delete(creatorContent).where(eq(creatorContent.id, contentId));

  // Decrement creator's content count
  await db
    .update(creatorProfiles)
    .set({ contentCount: sql`GREATEST(${creatorProfiles.contentCount} - 1, 0)` })
    .where(eq(creatorProfiles.userId, userId));

  return NextResponse.json({ success: true, data: { deleted: true } });
}
