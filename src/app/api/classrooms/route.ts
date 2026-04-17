import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { classrooms, classroomMembers } from "@/db/schema/classrooms";
import { users } from "@/db/schema/auth";
import { boards, standards, subjects } from "@/db/schema/curriculum";
import { eq, and, desc, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { randomBytes } from "crypto";

// ---------------------------------------------------------------------------
// GET /api/classrooms — List classrooms (teacher's or student's)
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Login required" } }, { status: 401 });

  const userId = Number(session.user.id);
  const role = request.nextUrl.searchParams.get("role") || "teacher";

  if (role === "teacher") {
    const items = await db
      .select({
        id: classrooms.id, name: classrooms.name, joinCode: classrooms.joinCode,
        studentCount: classrooms.studentCount, maxStudents: classrooms.maxStudents,
        isActive: classrooms.isActive, academicYear: classrooms.academicYear,
        boardId: classrooms.boardId, standardId: classrooms.standardId,
        subjectId: classrooms.subjectId, description: classrooms.description,
        createdAt: classrooms.createdAt,
        boardName: boards.name, standardGrade: standards.grade, subjectName: subjects.name,
      })
      .from(classrooms)
      .leftJoin(boards, eq(boards.id, classrooms.boardId))
      .leftJoin(standards, eq(standards.id, classrooms.standardId))
      .leftJoin(subjects, eq(subjects.id, classrooms.subjectId))
      .where(eq(classrooms.teacherId, userId))
      .orderBy(desc(classrooms.createdAt));
    return NextResponse.json({ success: true, data: items });
  }

  // Student: list enrolled classrooms
  const items = await db
    .select({
      id: classrooms.id, name: classrooms.name, description: classrooms.description,
      studentCount: classrooms.studentCount, academicYear: classrooms.academicYear,
      teacherName: users.fullName, teacherAvatar: users.avatarUrl,
      boardName: boards.name, standardGrade: standards.grade, subjectName: subjects.name,
      joinedAt: classroomMembers.joinedAt,
    })
    .from(classroomMembers)
    .innerJoin(classrooms, eq(classrooms.id, classroomMembers.classroomId))
    .innerJoin(users, eq(users.id, classrooms.teacherId))
    .leftJoin(boards, eq(boards.id, classrooms.boardId))
    .leftJoin(standards, eq(standards.id, classrooms.standardId))
    .leftJoin(subjects, eq(subjects.id, classrooms.subjectId))
    .where(and(eq(classroomMembers.studentId, userId), eq(classroomMembers.status, "active")))
    .orderBy(desc(classroomMembers.joinedAt));

  return NextResponse.json({ success: true, data: items });
}

// ---------------------------------------------------------------------------
// POST /api/classrooms — Create a new classroom
// ---------------------------------------------------------------------------
const createSchema = z.object({
  name: z.string().min(2).max(255),
  description: z.string().max(1000).optional(),
  boardId: z.number().optional(),
  standardId: z.number().optional(),
  subjectId: z.number().optional(),
  academicYear: z.string().max(10).optional(),
  maxStudents: z.number().min(1).max(1000).optional(),
});

function generateInviteCode(): string {
  // 6-char uppercase alphanumeric (exclude 0/O/1/I/L for readability)
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(6);
  return Array.from(bytes).map(b => chars[b % chars.length]).join("");
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Login required" } }, { status: 401 });

  const userId = Number(session.user.id);
  let body;
  try { body = await request.json(); } catch {
    return NextResponse.json({ success: false, error: { code: "INVALID_JSON", message: "Invalid JSON" } }, { status: 400 });
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } }, { status: 400 });

  // Generate unique invite code (retry if collision)
  let joinCode = generateInviteCode();
  for (let attempt = 0; attempt < 5; attempt++) {
    const [existing] = await db.select({ id: classrooms.id }).from(classrooms).where(eq(classrooms.joinCode, joinCode)).limit(1);
    if (!existing) break;
    joinCode = generateInviteCode();
  }

  const [classroom] = await db.insert(classrooms).values({
    teacherId: userId,
    name: parsed.data.name,
    description: parsed.data.description ?? null,
    boardId: parsed.data.boardId ?? null,
    standardId: parsed.data.standardId ?? null,
    subjectId: parsed.data.subjectId ?? null,
    academicYear: parsed.data.academicYear ?? null,
    maxStudents: parsed.data.maxStudents ?? 100,
    joinCode,
  }).returning();

  return NextResponse.json({ success: true, data: classroom }, { status: 201 });
}
