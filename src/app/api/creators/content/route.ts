import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { creatorContent } from "@/db/schema/creators";
import { boards, standards, subjects, chapters } from "@/db/schema/curriculum";
import { eq, and, desc, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { checkCreator } from "@/lib/check-creator";

const querySchema = z.object({
  contentType: z.string().optional(),
  reviewStatus: z.string().optional(),
  isPublished: z.enum(["true", "false"]).optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
});

// ---------------------------------------------------------------------------
// GET /api/creators/content — List current creator's content with curriculum info
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest) {
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
  const params = Object.fromEntries(request.nextUrl.searchParams);
  const parsed = querySchema.safeParse(params);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } },
      { status: 400 }
    );
  }

  const { contentType, reviewStatus, isPublished, page, limit } = parsed.data;
  const offset = (page - 1) * limit;

  const conditions = [eq(creatorContent.creatorId, userId)];
  if (contentType) conditions.push(eq(creatorContent.contentType, contentType));
  if (reviewStatus) conditions.push(eq(creatorContent.reviewStatus, reviewStatus));
  if (isPublished !== undefined) conditions.push(eq(creatorContent.isPublished, isPublished === "true"));

  const whereClause = and(...conditions);

  const [items, countResult] = await Promise.all([
    db
      .select({
        id: creatorContent.id,
        creatorId: creatorContent.creatorId,
        contentType: creatorContent.contentType,
        title: creatorContent.title,
        description: creatorContent.description,
        body: creatorContent.body,
        mediaUrl: creatorContent.mediaUrl,
        thumbnailUrl: creatorContent.thumbnailUrl,
        durationSeconds: creatorContent.durationSeconds,
        boardId: creatorContent.boardId,
        standardId: creatorContent.standardId,
        subjectId: creatorContent.subjectId,
        chapterId: creatorContent.chapterId,
        topicId: creatorContent.topicId,
        isPremium: creatorContent.isPremium,
        language: creatorContent.language,
        viewCount: creatorContent.viewCount,
        likeCount: creatorContent.likeCount,
        shareCount: creatorContent.shareCount,
        reviewStatus: creatorContent.reviewStatus,
        isPublished: creatorContent.isPublished,
        publishedAt: creatorContent.publishedAt,
        metadata: creatorContent.metadata,
        createdAt: creatorContent.createdAt,
        updatedAt: creatorContent.updatedAt,
        // Curriculum names via left joins
        boardName: boards.name,
        boardCode: boards.code,
        standardGrade: standards.grade,
        subjectName: subjects.name,
        chapterTitle: chapters.title,
        chapterNumber: chapters.chapterNumber,
      })
      .from(creatorContent)
      .leftJoin(boards, eq(boards.id, creatorContent.boardId))
      .leftJoin(standards, eq(standards.id, creatorContent.standardId))
      .leftJoin(subjects, eq(subjects.id, creatorContent.subjectId))
      .leftJoin(chapters, eq(chapters.id, creatorContent.chapterId))
      .where(whereClause)
      .orderBy(desc(creatorContent.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(creatorContent)
      .where(whereClause),
  ]);

  const total = countResult[0]?.count ?? 0;

  return NextResponse.json({
    success: true,
    data: {
      items,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    },
  });
}
