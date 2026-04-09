import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema/auth";
import { creatorProfiles, creatorContent } from "@/db/schema/creators";
import { eq, and, sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// GET /api/creators/[id] — Public creator profile
// ---------------------------------------------------------------------------
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const creatorId = Number(id);
  if (isNaN(creatorId)) {
    return NextResponse.json(
      { success: false, error: { code: "VALIDATION_ERROR", message: "Invalid creator ID" } },
      { status: 400 }
    );
  }

  const [profile] = await db
    .select({
      id: creatorProfiles.id,
      userId: creatorProfiles.userId,
      displayName: creatorProfiles.displayName,
      bio: creatorProfiles.bio,
      institution: creatorProfiles.institution,
      institutionType: creatorProfiles.institutionType,
      boards: creatorProfiles.boards,
      subjects: creatorProfiles.subjects,
      classesFrom: creatorProfiles.classesFrom,
      classesTo: creatorProfiles.classesTo,
      websiteUrl: creatorProfiles.websiteUrl,
      socialLinks: creatorProfiles.socialLinks,
      rating: creatorProfiles.rating,
      followerCount: creatorProfiles.followerCount,
      contentCount: creatorProfiles.contentCount,
      isFeatured: creatorProfiles.isFeatured,
      createdAt: creatorProfiles.createdAt,
      userName: users.fullName,
      userAvatar: users.avatarUrl,
      creatorVerified: users.creatorVerified,
    })
    .from(creatorProfiles)
    .innerJoin(users, eq(users.id, creatorProfiles.userId))
    .where(eq(creatorProfiles.userId, creatorId))
    .limit(1);

  if (!profile) {
    return NextResponse.json(
      { success: false, error: { code: "NOT_FOUND", message: "Creator not found" } },
      { status: 404 }
    );
  }

  // Get published content count
  const [contentStats] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(creatorContent)
    .where(
      and(
        eq(creatorContent.creatorId, creatorId),
        eq(creatorContent.isPublished, true)
      )
    );

  return NextResponse.json({
    success: true,
    data: {
      ...profile,
      publishedContentCount: contentStats?.count ?? 0,
    },
  });
}
