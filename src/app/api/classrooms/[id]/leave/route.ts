import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { classrooms, classroomMembers } from "@/db/schema/classrooms";
import { eq, and, sql } from "drizzle-orm";

// POST /api/classrooms/[id]/leave — Student leaves a classroom
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Login required" } }, { status: 401 });

  const { id } = await params;
  const classroomId = Number(id);
  const userId = Number(session.user.id);

  const [member] = await db.select({ id: classroomMembers.id, status: classroomMembers.status })
    .from(classroomMembers)
    .where(and(eq(classroomMembers.classroomId, classroomId), eq(classroomMembers.studentId, userId)))
    .limit(1);

  if (!member || member.status !== "active") {
    return NextResponse.json({ success: false, error: { code: "NOT_MEMBER", message: "You are not a member of this classroom" } }, { status: 400 });
  }

  await db.update(classroomMembers).set({ status: "left", removedAt: new Date() }).where(eq(classroomMembers.id, member.id));
  await db.update(classrooms).set({ studentCount: sql`GREATEST(${classrooms.studentCount} - 1, 0)` }).where(eq(classrooms.id, classroomId));

  return NextResponse.json({ success: true, data: { left: true } });
}
