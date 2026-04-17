import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema/auth";
import { creatorProfiles, creatorContent } from "@/db/schema/creators";
import { eq, and, desc, sql } from "drizzle-orm";

/**
 * GET /api/creators/featured — Public featured creators
 *
 * Returns top creators ordered by: isFeatured DESC, followerCount DESC.
 * Includes count of published content for each creator.
 *
 * No auth required. Used on landing page, explore page.
 */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const limit = Math.min(Math.max(Number(sp.get("limit")) || 6, 1), 20);

  const creators = await db
    .select({
      userId: creatorProfiles.userId,
      displayName: creatorProfiles.displayName,
      bio: creatorProfiles.bio,
      institution: creatorProfiles.institution,
      institutionType: creatorProfiles.institutionType,
      boards: creatorProfiles.boards,
      subjects: creatorProfiles.subjects,
      rating: creatorProfiles.rating,
      followerCount: creatorProfiles.followerCount,
      contentCount: creatorProfiles.contentCount,
      isFeatured: creatorProfiles.isFeatured,
      avatarUrl: users.avatarUrl,
      fullName: users.fullName,
      creatorVerified: users.creatorVerified,
      publishedCount: sql<number>`(
        SELECT count(*)::int FROM ${creatorContent}
        WHERE ${creatorContent.creatorId} = ${creatorProfiles.userId}
          AND ${creatorContent.isPublished} = true
          AND ${creatorContent.reviewStatus} = 'approved'
      )`,
    })
    .from(creatorProfiles)
    .innerJoin(users, eq(users.id, creatorProfiles.userId))
    .where(eq(creatorProfiles.isActive, true))
    .orderBy(desc(creatorProfiles.isFeatured), desc(creatorProfiles.followerCount), desc(creatorProfiles.contentCount))
    .limit(limit);

  return NextResponse.json({ success: true, data: { creators } });
}
