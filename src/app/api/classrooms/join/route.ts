import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { classrooms, classroomMembers } from "@/db/schema/classrooms";
import { eq, and, sql } from "drizzle-orm";
import { z } from "zod/v4";

const joinSchema = z.object({ joinCode: z.string().min(4).max(20) });

// POST /api/classrooms/join — Student joins a classroom by invite code
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Login required" } }, { status: 401 });
  const userId = Number(session.user.id);

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ success: false, error: { code: "INVALID_JSON", message: "Invalid JSON" } }, { status: 400 }); }
  const parsed = joinSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } }, { status: 400 });

  const code = parsed.data.joinCode.toUpperCase().trim();

  // Find classroom
  const [classroom] = await db.select().from(classrooms).where(eq(classrooms.joinCode, code)).limit(1);
  if (!classroom) return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "Invalid invite code" } }, { status: 404 });
  if (!classroom.isActive) return NextResponse.json({ success: false, error: { code: "INACTIVE", message: "This classroom is no longer active" } }, { status: 400 });
  if (classroom.studentCount >= classroom.maxStudents) return NextResponse.json({ success: false, error: { code: "FULL", message: "This classroom is full" } }, { status: 400 });
  if (classroom.teacherId === userId) return NextResponse.json({ success: false, error: { code: "INVALID", message: "You are the teacher of this classroom" } }, { status: 400 });

  // Check if already a member
  const [existing] = await db.select({ id: classroomMembers.id, status: classroomMembers.status })
    .from(classroomMembers).where(and(eq(classroomMembers.classroomId, classroom.id), eq(classroomMembers.studentId, userId))).limit(1);
  if (existing?.status === "active") return NextResponse.json({ success: false, error: { code: "ALREADY_MEMBER", message: "You are already in this classroom" } }, { status: 400 });

  // Join (or re-activate if previously left/removed)
  if (existing) {
    await db.update(classroomMembers).set({ status: "active", removedAt: null, joinedAt: new Date() }).where(eq(classroomMembers.id, existing.id));
  } else {
    await db.insert(classroomMembers).values({ classroomId: classroom.id, studentId: userId });
  }
  await db.update(classrooms).set({ studentCount: sql`${classrooms.studentCount} + 1` }).where(eq(classrooms.id, classroom.id));

  return NextResponse.json({ success: true, data: { classroomId: classroom.id, name: classroom.name } }, { status: 201 });
}
