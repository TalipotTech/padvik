import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { classrooms } from "@/db/schema/classrooms";
import { eq } from "drizzle-orm";
import { z } from "zod/v4";

// GET /api/classrooms/[id]
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Login required" } }, { status: 401 });
  const { id } = await params;
  const [classroom] = await db.select().from(classrooms).where(eq(classrooms.id, Number(id))).limit(1);
  if (!classroom) return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "Classroom not found" } }, { status: 404 });
  return NextResponse.json({ success: true, data: classroom });
}

// PATCH /api/classrooms/[id]
const updateSchema = z.object({
  name: z.string().min(2).max(255).optional(),
  description: z.string().max(1000).optional(),
  isActive: z.boolean().optional(),
  maxStudents: z.number().min(1).max(1000).optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
});

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Login required" } }, { status: 401 });
  const { id } = await params;
  const userId = Number(session.user.id);

  const [classroom] = await db.select({ teacherId: classrooms.teacherId }).from(classrooms).where(eq(classrooms.id, Number(id))).limit(1);
  if (!classroom || classroom.teacherId !== userId) return NextResponse.json({ success: false, error: { code: "FORBIDDEN", message: "Not your classroom" } }, { status: 403 });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ success: false, error: { code: "INVALID_JSON", message: "Invalid JSON" } }, { status: 400 }); }
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } }, { status: 400 });

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  for (const [k, v] of Object.entries(parsed.data)) { if (v !== undefined) updates[k] = v; }

  const [updated] = await db.update(classrooms).set(updates).where(eq(classrooms.id, Number(id))).returning();
  return NextResponse.json({ success: true, data: updated });
}

// DELETE /api/classrooms/[id] — soft delete
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Login required" } }, { status: 401 });
  const { id } = await params;
  const userId = Number(session.user.id);

  const [classroom] = await db.select({ teacherId: classrooms.teacherId }).from(classrooms).where(eq(classrooms.id, Number(id))).limit(1);
  if (!classroom || classroom.teacherId !== userId) return NextResponse.json({ success: false, error: { code: "FORBIDDEN", message: "Not your classroom" } }, { status: 403 });

  await db.update(classrooms).set({ isActive: false, updatedAt: new Date() }).where(eq(classrooms.id, Number(id)));
  return NextResponse.json({ success: true, data: { archived: true } });
}
