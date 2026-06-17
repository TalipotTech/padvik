import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { classrooms, classroomMembers } from "@/db/schema/classrooms";
import { creatorContent } from "@/db/schema/creators";
import { eq, and, or, sql, gte, count } from "drizzle-orm";

/**
 * GET /api/my/new-content-count?since=ISO_TIMESTAMP
 *
 * Returns count of new published content across all enrolled classrooms
 * since the given timestamp. Used for notification badges.
 *
 * The `since` param comes from client-side localStorage (MVP).
 * Phase 2: store in DB per classroomMember.
 */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Login required" } },
      { status: 401 }
    );
  }
  const userId = Number(session.user.id);
  // Demo sessions have IDs like "demo-student" — no real classroom data.
  if (!Number.isFinite(userId)) {
    return NextResponse.json({ success: true, data: { count: 0 } });
  }

  // Parse since timestamp — default to 24 hours ago if not provided
  const sinceParam = request.nextUrl.searchParams.get("since");
  const since = sinceParam ? new Date(sinceParam) : new Date(Date.now() - 24 * 60 * 60 * 1000);

  // Validate date
  if (isNaN(since.getTime())) {
    return NextResponse.json(
      { success: false, error: { code: "INVALID_PARAM", message: "Invalid since timestamp" } },
      { status: 400 }
    );
  }

  // Get student's active classrooms
  const memberships = await db
    .select({
      classroomId: classrooms.id,
      teacherId: classrooms.teacherId,
    })
    .from(classroomMembers)
    .innerJoin(classrooms, eq(classrooms.id, classroomMembers.classroomId))
    .where(
      and(
        eq(classroomMembers.studentId, userId),
        eq(classroomMembers.status, "active"),
        eq(classrooms.isActive, true)
      )
    );

  if (memberships.length === 0) {
    return NextResponse.json({ success: true, data: { count: 0 } });
  }

  // Build OR conditions for each classroom
  const classroomConditions = memberships.map((m) =>
    or(
      sql`${m.classroomId} = ANY(${creatorContent.assignedClassrooms})`,
      and(
        eq(creatorContent.creatorId, m.teacherId),
        eq(creatorContent.isPublished, true)
      )
    )
  );

  // Count new content since timestamp
  const [result] = await db
    .select({ total: count() })
    .from(creatorContent)
    .where(
      and(
        or(...classroomConditions),
        gte(creatorContent.createdAt, since),
        eq(creatorContent.isPublished, true)
      )
    );

  return NextResponse.json({
    success: true,
    data: { count: result?.total ?? 0 },
  });
}
