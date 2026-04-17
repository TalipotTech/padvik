import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { classrooms, classroomMembers } from "@/db/schema/classrooms";
import { eq, and, sql } from "drizzle-orm";

// DELETE /api/classrooms/[id]/members/[memberId] — Remove a student
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; memberId: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Login required" } }, { status: 401 });
  const { id, memberId } = await params;
  const userId = Number(session.user.id);

  // Verify teacher ownership
  const [classroom] = await db.select({ teacherId: classrooms.teacherId }).from(classrooms).where(eq(classrooms.id, Number(id))).limit(1);
  if (!classroom || classroom.teacherId !== userId) return NextResponse.json({ success: false, error: { code: "FORBIDDEN", message: "Not your classroom" } }, { status: 403 });

  const [updated] = await db.update(classroomMembers)
    .set({ status: "removed", removedAt: new Date() })
    .where(and(eq(classroomMembers.id, Number(memberId)), eq(classroomMembers.classroomId, Number(id))))
    .returning();

  if (updated) {
    await db.update(classrooms).set({ studentCount: sql`GREATEST(${classrooms.studentCount} - 1, 0)` }).where(eq(classrooms.id, Number(id)));
  }

  return NextResponse.json({ success: true, data: { removed: true } });
}
