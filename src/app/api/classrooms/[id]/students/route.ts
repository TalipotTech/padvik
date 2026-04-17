import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { classrooms, classroomMembers } from "@/db/schema/classrooms";
import { users } from "@/db/schema/auth";
import { contentViews } from "@/db/schema/creators";
import { doubts } from "@/db/schema/doubts";
import { eq, and, sql, inArray } from "drizzle-orm";

// GET /api/classrooms/[id]/students — Creator sees enrolled students with progress
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Login required" } }, { status: 401 });

  const { id } = await params;
  const classroomId = Number(id);
  const userId = Number(session.user.id);

  // Verify teacher owns this classroom
  const [classroom] = await db.select({ teacherId: classrooms.teacherId }).from(classrooms).where(eq(classrooms.id, classroomId)).limit(1);
  if (!classroom || classroom.teacherId !== userId) {
    return NextResponse.json({ success: false, error: { code: "FORBIDDEN", message: "Not your classroom" } }, { status: 403 });
  }

  // Get active members
  const members = await db
    .select({
      memberId: classroomMembers.id,
      studentId: classroomMembers.studentId,
      joinedAt: classroomMembers.joinedAt,
      role: classroomMembers.role,
      studentName: users.fullName,
      studentEmail: users.email,
      studentAvatar: users.avatarUrl,
    })
    .from(classroomMembers)
    .innerJoin(users, eq(users.id, classroomMembers.studentId))
    .where(and(eq(classroomMembers.classroomId, classroomId), eq(classroomMembers.status, "active")));

  if (members.length === 0) {
    return NextResponse.json({ success: true, data: [] });
  }

  const studentIds = members.map(m => m.studentId);

  // Get progress stats: views on THIS CREATOR'S content only (privacy rule)
  const viewStats = await db
    .select({
      userId: contentViews.userId,
      totalViews: sql<number>`count(*)::int`,
      totalWatchSeconds: sql<number>`COALESCE(sum(${contentViews.watchedSeconds}), 0)::int`,
      completedCount: sql<number>`count(*) FILTER (WHERE ${contentViews.completed} = true)::int`,
    })
    .from(contentViews)
    .where(and(
      eq(contentViews.creatorId, userId), // ONLY this creator's content
      inArray(contentViews.userId, studentIds)
    ))
    .groupBy(contentViews.userId);

  // Get doubt counts per student for this creator
  const doubtStats = await db
    .select({
      studentId: doubts.studentId,
      doubtCount: sql<number>`count(*)::int`,
    })
    .from(doubts)
    .where(and(
      eq(doubts.creatorId, userId),
      inArray(doubts.studentId, studentIds)
    ))
    .groupBy(doubts.studentId);

  // Merge progress into member data
  const viewMap = new Map(viewStats.map(v => [v.userId, v]));
  const doubtMap = new Map(doubtStats.map(d => [d.studentId, d]));

  const result = members.map(m => ({
    ...m,
    progress: {
      totalViews: viewMap.get(m.studentId)?.totalViews || 0,
      watchMinutes: Math.round((viewMap.get(m.studentId)?.totalWatchSeconds || 0) / 60),
      completedContent: viewMap.get(m.studentId)?.completedCount || 0,
      doubtsAsked: doubtMap.get(m.studentId)?.doubtCount || 0,
    },
  }));

  return NextResponse.json({ success: true, data: result });
}
