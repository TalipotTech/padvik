import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema/auth";
import { creatorContent, creatorProfiles } from "@/db/schema/creators";
import { eq, and, sql } from "drizzle-orm";

/**
 * GET /api/content/featured — Public trending/featured content
 *
 * Returns content ordered by a trending score:
 *   viewCount*0.4 + likeCount*0.3 + recencyFactor*30
 * where recencyFactor = max(0, 1 - age_days / days_window)
 *
 * No auth required. Used on landing page, explore page, student dashboard.
 */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const boardId = sp.get("boardId") ? Number(sp.get("boardId")) : null;
  const contentType = sp.get("contentType");
  const limit = Math.min(Math.max(Number(sp.get("limit")) || 12, 1), 30);
  const days = Math.min(Math.max(Number(sp.get("days")) || 30, 1), 90);

  const conditions = [
    eq(creatorContent.isPublished, true),
    eq(creatorContent.reviewStatus, "approved"),
  ];

  if (boardId) conditions.push(eq(creatorContent.boardId, boardId));
  if (contentType) conditions.push(eq(creatorContent.contentType, contentType));

  // Trending score: views*0.4 + likes*0.3 + recency*30
  // Recency: max(0, 1 - age_seconds / (days * 86400)) — decays linearly over the window
  const trendingScore = sql<number>`
    COALESCE(${creatorContent.viewCount}, 0) * 0.4 +
    COALESCE(${creatorContent.likeCount}, 0) * 0.3 +
    GREATEST(0, 1.0 - EXTRACT(EPOCH FROM (NOW() - ${creatorContent.publishedAt})) / (${days} * 86400)) * 30
  `;

  const items = await db
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
      trendingScore,
    })
    .from(creatorContent)
    .innerJoin(creatorProfiles, eq(creatorProfiles.userId, creatorContent.creatorId))
    .innerJoin(users, eq(users.id, creatorContent.creatorId))
    .where(and(...conditions))
    .orderBy(sql`${trendingScore} DESC`)
    .limit(limit);

  return NextResponse.json({ success: true, data: { items } });
}
