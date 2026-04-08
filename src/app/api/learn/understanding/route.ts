import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { topicUnderstanding } from "@/db/schema/learn";
import { eq, and } from "drizzle-orm";
import { z } from "zod/v4";

/**
 * GET /api/learn/understanding?topicId=14
 * POST /api/learn/understanding — upsert understanding level
 */

export async function GET(request: NextRequest) {
  let userId: number | null = null;
  try { const s = await auth(); userId = s?.user?.id ? Number(s.user.id) : null; } catch { /* auth failed */ }
  if (!userId && process.env.NODE_ENV === "development") userId = 1;
  if (!userId) {
    return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Login required" } }, { status: 401 });
  }
  const topicId = request.nextUrl.searchParams.get("topicId");

  if (topicId) {
    const [record] = await db.select().from(topicUnderstanding)
      .where(and(eq(topicUnderstanding.userId, userId), eq(topicUnderstanding.topicId, parseInt(topicId, 10))))
      .limit(1);
    return NextResponse.json({ success: true, data: record ?? null });
  }

  // Return all understanding records for this user
  const records = await db.select().from(topicUnderstanding).where(eq(topicUnderstanding.userId, userId));
  return NextResponse.json({ success: true, data: records });
}

const schema = z.object({
  topicId: z.number().int(),
  level: z.enum(["red", "orange", "green"]),
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
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } }, { status: 400 });
  }

  const { topicId, level } = parsed.data;

  const [existing] = await db.select({ id: topicUnderstanding.id }).from(topicUnderstanding)
    .where(and(eq(topicUnderstanding.userId, userId), eq(topicUnderstanding.topicId, topicId))).limit(1);

  if (existing) {
    await db.update(topicUnderstanding)
      .set({ understandingLevel: level, updatedAt: new Date() })
      .where(eq(topicUnderstanding.id, existing.id));
    return NextResponse.json({ success: true, data: { id: existing.id, level } });
  } else {
    const [created] = await db.insert(topicUnderstanding)
      .values({ userId, topicId, understandingLevel: level })
      .returning();
    return NextResponse.json({ success: true, data: created }, { status: 201 });
  }
}
