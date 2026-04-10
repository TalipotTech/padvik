import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { classrooms } from "@/db/schema/classrooms";
import { creatorContent } from "@/db/schema/creators";
import { eq, sql, arrayContains } from "drizzle-orm";

// GET /api/classrooms/[id]/content — List content assigned to this classroom
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Login required" } }, { status: 401 });
  const { id } = await params;
  const classroomId = Number(id);

  const items = await db.select()
    .from(creatorContent)
    .where(sql`${classroomId} = ANY(${creatorContent.assignedClassrooms})`)
    .orderBy(creatorContent.createdAt);

  return NextResponse.json({ success: true, data: items });
}

// POST /api/classrooms/[id]/content — Assign content to classroom
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Login required" } }, { status: 401 });
  const { id } = await params;
  const userId = Number(session.user.id);
  const classroomId = Number(id);

  // Verify teacher
  const [classroom] = await db.select({ teacherId: classrooms.teacherId }).from(classrooms).where(eq(classrooms.id, classroomId)).limit(1);
  if (!classroom || classroom.teacherId !== userId) return NextResponse.json({ success: false, error: { code: "FORBIDDEN", message: "Not your classroom" } }, { status: 403 });

  let body: { contentId: number };
  try { body = await request.json(); } catch { return NextResponse.json({ success: false, error: { code: "INVALID_JSON", message: "Invalid JSON" } }, { status: 400 }); }

  // Append classroomId to assignedClassrooms array
  await db.update(creatorContent).set({
    assignedClassrooms: sql`array_append(${creatorContent.assignedClassrooms}, ${classroomId})`,
    updatedAt: new Date(),
  }).where(eq(creatorContent.id, body.contentId));

  return NextResponse.json({ success: true, data: { assigned: true } });
}
