import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { classrooms, classroomMembers } from "@/db/schema/classrooms";
import { creatorContent } from "@/db/schema/creators";
import { users } from "@/db/schema/auth";
import { eq, and, desc, or, sql, gte } from "drizzle-orm";

/**
 * GET /api/my/classroom-feed
 *
 * Returns recent content from ALL enrolled classrooms, grouped by classroom.
 * Used by the student dashboard "My Classrooms" section.
 *
 * Response: { classrooms: [{ id, name, teacherName, teacherAvatar, content: [...] }] }
 */
export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Login required" } },
      { status: 401 }
    );
  }
  const userId = Number(session.user.id);

  // 1. Get student's active classroom memberships
  const memberships = await db
    .select({
      classroomId: classrooms.id,
      classroomName: classrooms.name,
      teacherId: classrooms.teacherId,
      teacherName: users.fullName,
      teacherAvatar: users.avatarUrl,
    })
    .from(classroomMembers)
    .innerJoin(classrooms, eq(classrooms.id, classroomMembers.classroomId))
    .innerJoin(users, eq(users.id, classrooms.teacherId))
    .where(
      and(
        eq(classroomMembers.studentId, userId),
        eq(classroomMembers.status, "active"),
        eq(classrooms.isActive, true)
      )
    )
    .orderBy(desc(classroomMembers.joinedAt))
    .limit(6); // Max 6 classrooms on dashboard

  if (memberships.length === 0) {
    return NextResponse.json({ success: true, data: { classrooms: [] } });
  }

  // 2. For each classroom, get latest 3 content items
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const classroomFeed = await Promise.all(
    memberships.map(async (m) => {
      const items = await db
        .select({
          id: creatorContent.id,
          title: creatorContent.title,
          contentType: creatorContent.contentType,
          thumbnailUrl: creatorContent.thumbnailUrl,
          aiSummary: creatorContent.aiSummary,
          createdAt: creatorContent.createdAt,
        })
        .from(creatorContent)
        .where(
          and(
            or(
              sql`${m.classroomId} = ANY(${creatorContent.assignedClassrooms})`,
              and(
                eq(creatorContent.creatorId, m.teacherId),
                eq(creatorContent.isPublished, true)
              )
            ),
            gte(creatorContent.createdAt, thirtyDaysAgo)
          )
        )
        .orderBy(desc(creatorContent.createdAt))
        .limit(3);

      return {
        id: m.classroomId,
        name: m.classroomName,
        teacherName: m.teacherName,
        teacherAvatar: m.teacherAvatar,
        content: items,
      };
    })
  );

  // Filter out classrooms with no recent content, but keep empty ones so dashboard shows them
  return NextResponse.json({ success: true, data: { classrooms: classroomFeed } });
}
