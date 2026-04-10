import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { users } from "@/db/schema/auth";
import { creatorProfiles, creatorFollowers } from "@/db/schema/creators";
import { eq, desc } from "drizzle-orm";

// GET /api/my/following — List creators the student follows
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Login required" } }, { status: 401 });

  const userId = Number(session.user.id);

  const following = await db
    .select({
      id: creatorFollowers.id,
      creatorId: creatorFollowers.creatorId,
      followedAt: creatorFollowers.followedAt,
      displayName: creatorProfiles.displayName,
      bio: creatorProfiles.bio,
      institution: creatorProfiles.institution,
      followerCount: creatorProfiles.followerCount,
      contentCount: creatorProfiles.contentCount,
      creatorAvatar: users.avatarUrl,
      creatorVerified: users.creatorVerified,
    })
    .from(creatorFollowers)
    .innerJoin(creatorProfiles, eq(creatorProfiles.userId, creatorFollowers.creatorId))
    .innerJoin(users, eq(users.id, creatorFollowers.creatorId))
    .where(eq(creatorFollowers.studentId, userId))
    .orderBy(desc(creatorFollowers.followedAt));

  return NextResponse.json({ success: true, data: following });
}
