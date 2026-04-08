import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { userHighlights } from "@/db/schema/learn";
import { eq, and } from "drizzle-orm";
import { z } from "zod/v4";

/**
 * GET /api/learn/highlight?contentItemId=14 — Get highlights for a content item
 * POST /api/learn/highlight — Save a new highlight
 * DELETE /api/learn/highlight?id=5 — Remove a highlight
 */

export async function GET(request: NextRequest) {
  let userId: number | null = null;
  try { const s = await auth(); userId = s?.user?.id ? Number(s.user.id) : null; } catch { /* auth failed */ }
  if (!userId && process.env.NODE_ENV === "development") userId = 1;
  if (!userId) {
    return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Login required" } }, { status: 401 });
  }
  const contentItemId = request.nextUrl.searchParams.get("contentItemId");

  if (!contentItemId) {
    return NextResponse.json({ success: false, error: { code: "MISSING_PARAM", message: "contentItemId required" } }, { status: 400 });
  }

  const highlights = await db
    .select()
    .from(userHighlights)
    .where(and(eq(userHighlights.userId, userId), eq(userHighlights.contentItemId, parseInt(contentItemId, 10))))
    .orderBy(userHighlights.startOffset);

  return NextResponse.json({ success: true, data: highlights });
}

const highlightSchema = z.object({
  contentItemId: z.number().int(),
  highlightedText: z.string().min(1),
  note: z.string().optional(),
  color: z.enum(["red", "orange", "green", "yellow", "blue", "pink"]).optional(),
  startOffset: z.number().int().min(0),
  endOffset: z.number().int().min(0),
  sectionId: z.string().optional(),
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

  const parsed = highlightSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } }, { status: 400 });
  }

  const [created] = await db
    .insert(userHighlights)
    .values({ userId, ...parsed.data })
    .returning();

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

  await db.delete(userHighlights).where(and(eq(userHighlights.id, parseInt(id, 10)), eq(userHighlights.userId, userId)));
  return NextResponse.json({ success: true });
}
