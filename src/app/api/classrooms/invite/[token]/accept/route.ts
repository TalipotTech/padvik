import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { classrooms, classroomMembers, classroomInvites } from "@/db/schema/classrooms";
import { eq, and, sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// POST /api/classrooms/invite/[token]/accept — Accept an invite and join
// ---------------------------------------------------------------------------
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Login required to accept invite" } }, { status: 401 });
  }

  const { token } = await params;
  const userId = Number(session.user.id);

  // Find invite
  const [invite] = await db
    .select()
    .from(classroomInvites)
    .where(eq(classroomInvites.inviteToken, token))
    .limit(1);

  if (!invite) {
    return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "Invalid invite" } }, { status: 404 });
  }

  if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) {
    return NextResponse.json({ success: false, error: { code: "EXPIRED", message: "This invite has expired" } }, { status: 410 });
  }

  if (invite.status === "accepted") {
    return NextResponse.json({ success: false, error: { code: "ALREADY_USED", message: "This invite has already been accepted" } }, { status: 410 });
  }

  // Check classroom
  const [classroom] = await db
    .select({ id: classrooms.id, teacherId: classrooms.teacherId, studentCount: classrooms.studentCount, maxStudents: classrooms.maxStudents, isActive: classrooms.isActive, name: classrooms.name })
    .from(classrooms)
    .where(eq(classrooms.id, invite.classroomId))
    .limit(1);

  if (!classroom || !classroom.isActive) {
    return NextResponse.json({ success: false, error: { code: "INACTIVE", message: "Classroom is no longer active" } }, { status: 400 });
  }

  if (classroom.teacherId === userId) {
    return NextResponse.json({ success: false, error: { code: "INVALID", message: "You are the teacher of this classroom" } }, { status: 400 });
  }

  if (classroom.studentCount >= classroom.maxStudents) {
    return NextResponse.json({ success: false, error: { code: "FULL", message: "Classroom is full" } }, { status: 400 });
  }

  // Check if already a member
  const [existing] = await db
    .select({ id: classroomMembers.id, status: classroomMembers.status })
    .from(classroomMembers)
    .where(and(eq(classroomMembers.classroomId, classroom.id), eq(classroomMembers.studentId, userId)))
    .limit(1);

  if (existing?.status === "active") {
    // Already a member — just mark invite as accepted
    await db.update(classroomInvites).set({ status: "accepted", acceptedAt: new Date(), acceptedBy: userId }).where(eq(classroomInvites.id, invite.id));
    return NextResponse.json({ success: true, data: { classroomId: classroom.id, name: classroom.name, alreadyMember: true } });
  }

  // Join (or re-activate)
  if (existing) {
    await db.update(classroomMembers).set({ status: "active", removedAt: null, joinedAt: new Date() }).where(eq(classroomMembers.id, existing.id));
  } else {
    await db.insert(classroomMembers).values({ classroomId: classroom.id, studentId: userId });
  }

  // Increment student count
  await db.update(classrooms).set({ studentCount: sql`${classrooms.studentCount} + 1` }).where(eq(classrooms.id, classroom.id));

  // Mark invite as accepted
  await db.update(classroomInvites).set({ status: "accepted", acceptedAt: new Date(), acceptedBy: userId }).where(eq(classroomInvites.id, invite.id));

  return NextResponse.json({ success: true, data: { classroomId: classroom.id, name: classroom.name } }, { status: 201 });
}
