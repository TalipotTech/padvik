import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { classrooms, classroomMembers } from "@/db/schema/classrooms";
import { users } from "@/db/schema/auth";
import { boards, standards, subjects } from "@/db/schema/curriculum";
import { eq, and, desc } from "drizzle-orm";

// GET /api/my/classrooms — Student's enrolled classrooms
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Login required" } }, { status: 401 });
  const userId = Number(session.user.id);

  const items = await db
    .select({
      id: classrooms.id, name: classrooms.name, description: classrooms.description,
      studentCount: classrooms.studentCount, academicYear: classrooms.academicYear,
      joinCode: classrooms.joinCode,
      teacherName: users.fullName, teacherAvatar: users.avatarUrl,
      boardName: boards.name, standardGrade: standards.grade, subjectName: subjects.name,
      joinedAt: classroomMembers.joinedAt, memberRole: classroomMembers.role,
    })
    .from(classroomMembers)
    .innerJoin(classrooms, eq(classrooms.id, classroomMembers.classroomId))
    .innerJoin(users, eq(users.id, classrooms.teacherId))
    .leftJoin(boards, eq(boards.id, classrooms.boardId))
    .leftJoin(standards, eq(standards.id, classrooms.standardId))
    .leftJoin(subjects, eq(subjects.id, classrooms.subjectId))
    .where(and(eq(classroomMembers.studentId, userId), eq(classroomMembers.status, "active"), eq(classrooms.isActive, true)))
    .orderBy(desc(classroomMembers.joinedAt));

  return NextResponse.json({ success: true, data: items });
}
