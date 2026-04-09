import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { creatorProfiles, creatorFollowers } from "@/db/schema/creators";
import { eq, and, sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// POST /api/creators/[id]/follow — Follow a creator
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
  const creatorId = Number(id);
  const studentId = Number(session.user.id);

  if (isNaN(creatorId) || creatorId === studentId) {
    return NextResponse.json(
      { success: false, error: { code: "VALIDATION_ERROR", message: "Invalid creator ID" } },
      { status: 400 }
    );
  }

  // Check if already following
  const [existing] = await db
    .select({ id: creatorFollowers.id })
    .from(creatorFollowers)
    .where(
      and(
        eq(creatorFollowers.creatorId, creatorId),
        eq(creatorFollowers.studentId, studentId)
      )
    )
    .limit(1);

  if (existing) {
    return NextResponse.json(
      { success: false, error: { code: "ALREADY_FOLLOWING", message: "Already following this creator" } },
      { status: 400 }
    );
  }

  await db.transaction(async (tx) => {
    await tx.insert(creatorFollowers).values({ creatorId, studentId });
    await tx
      .update(creatorProfiles)
      .set({ followerCount: sql`${creatorProfiles.followerCount} + 1` })
      .where(eq(creatorProfiles.userId, creatorId));
  });

  return NextResponse.json({ success: true, data: { followed: true } }, { status: 201 });
}

// ---------------------------------------------------------------------------
// DELETE /api/creators/[id]/follow — Unfollow a creator
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
  const creatorId = Number(id);
  const studentId = Number(session.user.id);

  const [deleted] = await db
    .delete(creatorFollowers)
    .where(
      and(
        eq(creatorFollowers.creatorId, creatorId),
        eq(creatorFollowers.studentId, studentId)
      )
    )
    .returning({ id: creatorFollowers.id });

  if (deleted) {
    await db
      .update(creatorProfiles)
      .set({ followerCount: sql`GREATEST(${creatorProfiles.followerCount} - 1, 0)` })
      .where(eq(creatorProfiles.userId, creatorId));
  }

  return NextResponse.json({ success: true, data: { followed: false } });
}
