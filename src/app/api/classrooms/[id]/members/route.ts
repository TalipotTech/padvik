import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { classrooms, classroomMembers } from "@/db/schema/classrooms";
import { users } from "@/db/schema/auth";
import { eq, and } from "drizzle-orm";

// GET /api/classrooms/[id]/members — List classroom members
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Login required" } }, { status: 401 });
  const { id } = await params;
  const classroomId = Number(id);

  const members = await db
    .select({
      id: classroomMembers.id,
      studentId: classroomMembers.studentId,
      role: classroomMembers.role,
      status: classroomMembers.status,
      joinedAt: classroomMembers.joinedAt,
      studentName: users.fullName,
      studentEmail: users.email,
      studentAvatar: users.avatarUrl,
    })
    .from(classroomMembers)
    .innerJoin(users, eq(users.id, classroomMembers.studentId))
    .where(and(eq(classroomMembers.classroomId, classroomId), eq(classroomMembers.status, "active")));

  return NextResponse.json({ success: true, data: members });
}
