import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { userNotes } from "@/db/schema/content";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod/v4";

/**
 * GET /api/learn/notes?topicId=14 — List user's notes for a topic
 * POST /api/learn/notes — Create a note
 * DELETE /api/learn/notes?id=5 — Delete a note
 */

export async function GET(request: NextRequest) {
  let userId: number | null = null;
  try { const s = await auth(); userId = s?.user?.id ? Number(s.user.id) : null; } catch { /* auth failed */ }
  if (!userId && process.env.NODE_ENV === "development") userId = 1;
  if (!userId) {
    return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Login required" } }, { status: 401 });
  }
  const topicId = request.nextUrl.searchParams.get("topicId");
  if (!topicId) {
    return NextResponse.json({ success: false, error: { code: "MISSING_PARAM", message: "topicId required" } }, { status: 400 });
  }

  const notes = await db.select().from(userNotes)
    .where(and(eq(userNotes.userId, userId), eq(userNotes.topicId, parseInt(topicId, 10))))
    .orderBy(desc(userNotes.createdAt));

  return NextResponse.json({ success: true, data: notes });
}

const noteSchema = z.object({
  topicId: z.number().int(),
  title: z.string().optional(),
  body: z.string().min(1),
  contentItemId: z.number().int().optional(),
});

export async function POST(request: NextRequest) {
  let userId: number | null = null;
  try { const s = await auth(); userId = s?.user?.id ? Number(s.user.id) : null; } catch { /* auth failed */ }
  if (!userId && process.env.NODE_ENV === "development") userId = 1;
  if (!userId) {
    return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Login required" } }, { status: 401 });
  }

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ success: false, error: { code: "INVALID_JSON", message: "Invalid JSON" } }, { status: 400 });
  }
  const parsed = noteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } }, { status: 400 });
  }

  const [created] = await db.insert(userNotes).values({
    userId,
    topicId: parsed.data.topicId,
    title: parsed.data.title ?? null,
    body: parsed.data.body,
    contentItemId: parsed.data.contentItemId ?? null,
    isPrivate: true,
  }).returning();

  return NextResponse.json({ success: true, data: created }, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  let userId: number | null = null;
  try { const s = await auth(); userId = s?.user?.id ? Number(s.user.id) : null; } catch { /* auth failed */ }
  if (!userId && process.env.NODE_ENV === "development") userId = 1;
  if (!userId) {
    return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Login required" } }, { status: 401 });
  }
  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ success: false, error: { code: "MISSING_PARAM", message: "id required" } }, { status: 400 });
  }

  await db.delete(userNotes).where(and(eq(userNotes.id, parseInt(id, 10)), eq(userNotes.userId, userId)));
  return NextResponse.json({ success: true });
}
