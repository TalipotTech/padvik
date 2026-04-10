import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { classrooms, classroomInvites } from "@/db/schema/classrooms";
import { users } from "@/db/schema/auth";
import { boards, standards, subjects } from "@/db/schema/curriculum";
import { eq } from "drizzle-orm";

// ---------------------------------------------------------------------------
// GET /api/classrooms/invite/[token] — Get invite info (public)
// ---------------------------------------------------------------------------
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  const [invite] = await db
    .select()
    .from(classroomInvites)
    .where(eq(classroomInvites.inviteToken, token))
    .limit(1);

  if (!invite) {
    return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "Invalid or expired invite" } }, { status: 404 });
  }

  if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) {
    return NextResponse.json({ success: false, error: { code: "EXPIRED", message: "This invite has expired" } }, { status: 410 });
  }

  if (invite.status === "accepted") {
    return NextResponse.json({ success: false, error: { code: "ALREADY_USED", message: "This invite has already been accepted" } }, { status: 410 });
  }

  // Get classroom + creator info
  const [classroom] = await db
    .select({
      id: classrooms.id, name: classrooms.name, description: classrooms.description,
      joinCode: classrooms.joinCode, studentCount: classrooms.studentCount,
      maxStudents: classrooms.maxStudents,
      teacherName: users.fullName, teacherAvatar: users.avatarUrl,
      boardName: boards.name, standardGrade: standards.grade, subjectName: subjects.name,
    })
    .from(classrooms)
    .innerJoin(users, eq(users.id, classrooms.teacherId))
    .leftJoin(boards, eq(boards.id, classrooms.boardId))
    .leftJoin(standards, eq(standards.id, classrooms.standardId))
    .leftJoin(subjects, eq(subjects.id, classrooms.subjectId))
    .where(eq(classrooms.id, invite.classroomId))
    .limit(1);

  if (!classroom) {
    return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "Classroom not found" } }, { status: 404 });
  }

  return NextResponse.json({
    success: true,
    data: {
      invite: {
        token: invite.inviteToken,
        recipientName: invite.recipientName,
        status: invite.status,
      },
      classroom: {
        id: classroom.id,
        name: classroom.name,
        description: classroom.description,
        joinCode: classroom.joinCode,
        studentCount: classroom.studentCount,
        maxStudents: classroom.maxStudents,
        teacherName: classroom.teacherName,
        teacherAvatar: classroom.teacherAvatar,
        boardName: classroom.boardName,
        standardGrade: classroom.standardGrade,
        subjectName: classroom.subjectName,
      },
    },
  });
}
