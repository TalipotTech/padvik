import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { users } from "@/db/schema/auth";
import { creatorContent, creatorProfiles } from "@/db/schema/creators";
import { eq, and, ilike, desc, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { trackDemandSignal } from "@/lib/auto-content/demand-tracker";

const querySchema = z.object({
  contentType: z.string().optional(),
  boardId: z.coerce.number().optional(),
  subjectId: z.coerce.number().optional(),
  topicId: z.coerce.number().optional(),
  creatorId: z.coerce.number().optional(),
  search: z.string().optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(50).default(20),
});

// ---------------------------------------------------------------------------
// GET /api/content/browse — Public browsing of published creator content
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest) {
  const params = Object.fromEntries(request.nextUrl.searchParams);
  const parsed = querySchema.safeParse(params);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } },
      { status: 400 }
    );
  }

  const { contentType, boardId, subjectId, topicId, creatorId, search, page, limit } = parsed.data;
  const offset = (page - 1) * limit;

  const conditions = [
    eq(creatorContent.isPublished, true),
    eq(creatorContent.reviewStatus, "approved"),
  ];

  if (contentType) conditions.push(eq(creatorContent.contentType, contentType));
  if (boardId) conditions.push(eq(creatorContent.boardId, boardId));
  if (subjectId) conditions.push(eq(creatorContent.subjectId, subjectId));
  if (topicId) conditions.push(eq(creatorContent.topicId, topicId));
  if (creatorId) conditions.push(eq(creatorContent.creatorId, creatorId));
  if (search) conditions.push(ilike(creatorContent.title, `%${search}%`));

  const whereClause = and(...conditions);

  const [items, countResult] = await Promise.all([
    db
      .select({
        id: creatorContent.id,
        creatorId: creatorContent.creatorId,
        contentType: creatorContent.contentType,
        title: creatorContent.title,
        description: creatorContent.description,
        thumbnailUrl: creatorContent.thumbnailUrl,
        durationSeconds: creatorContent.durationSeconds,
        isPremium: creatorContent.isPremium,
        language: creatorContent.language,
        viewCount: creatorContent.viewCount,
        likeCount: creatorContent.likeCount,
        avgRating: creatorContent.avgRating,
        publishedAt: creatorContent.publishedAt,
        creatorName: creatorProfiles.displayName,
        creatorAvatar: users.avatarUrl,
        creatorVerified: users.creatorVerified,
      })
      .from(creatorContent)
      .innerJoin(creatorProfiles, eq(creatorProfiles.userId, creatorContent.creatorId))
      .innerJoin(users, eq(users.id, creatorContent.creatorId))
      .where(whereClause)
      .orderBy(desc(creatorContent.publishedAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(creatorContent)
      .where(whereClause),
  ]);

  const total = countResult[0]?.count ?? 0;

  // Demand signal: a topic-specific browse that surfaced no creator content.
  if (topicId && total === 0) {
    void (async () => {
      try {
        const s = await auth();
        const uid = s?.user?.id ? Number(s.user.id) : undefined;
        await trackDemandSignal(topicId, "search", uid, 2.0);
      } catch {
        /* non-critical */
      }
    })();
  }

  return NextResponse.json({
    success: true,
    data: {
      items,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    },
  });
}
