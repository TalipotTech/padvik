import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { readingProgress } from "@/db/schema/learn";
import { eq, and, sql } from "drizzle-orm";
import { z } from "zod/v4";

/**
 * GET /api/learn/progress?subjectId=X
 * Returns per-topic progress map for all topics in a subject.
 */
export async function GET(request: NextRequest) {
  let userId: number | null = null;
  try { const s = await auth(); userId = s?.user?.id ? Number(s.user.id) : null; } catch {}
  if (!userId && process.env.NODE_ENV === "development") userId = 1;
  if (!userId) {
    return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED" } }, { status: 401 });
  }

  const subjectId = request.nextUrl.searchParams.get("subjectId");
  if (!subjectId) {
    return NextResponse.json({ success: false, error: { code: "MISSING_PARAM", message: "subjectId required" } }, { status: 400 });
  }

  const sid = Number(subjectId);

  try {
    // Reading progress per topic
    const readRows = await db.execute<{ topic_id: number; percent: number }>(sql`
      SELECT ci.topic_id, MAX(rp.completion_percent)::int AS percent
      FROM reading_progress rp
      JOIN content_items ci ON ci.id = rp.content_item_id
      JOIN topics t ON t.id = ci.topic_id
      JOIN chapters ch ON ch.id = t.chapter_id
      WHERE rp.user_id = ${userId} AND ch.subject_id = ${sid}
      GROUP BY ci.topic_id
    `);

    // Understanding levels
    const undRows = await db.execute<{ topic_id: number; level: string }>(sql`
      SELECT tu.topic_id, tu.understanding_level AS level
      FROM topic_understanding tu
      JOIN topics t ON t.id = tu.topic_id
      JOIN chapters ch ON ch.id = t.chapter_id
      WHERE tu.user_id = ${userId} AND ch.subject_id = ${sid}
    `);

    // Visited (notes/chats/videos)
    const visitedRows = await db.execute<{ topic_id: number }>(sql`
      SELECT DISTINCT v.topic_id FROM (
        SELECT topic_id FROM user_notes WHERE user_id = ${userId} AND topic_id IS NOT NULL
        UNION SELECT topic_id FROM topic_conversations WHERE user_id = ${userId}
        UNION SELECT topic_id FROM user_videos WHERE user_id = ${userId}
      ) v
      JOIN topics t ON t.id = v.topic_id
      JOIN chapters ch ON ch.id = t.chapter_id
      WHERE ch.subject_id = ${sid}
    `);

    const topics: Record<number, { percent: number; understanding: string | null }> = {};

    for (const r of readRows) topics[r.topic_id] = { percent: r.percent ?? 0, understanding: null };
    for (const r of undRows) {
      if (!topics[r.topic_id]) topics[r.topic_id] = { percent: 0, understanding: r.level };
      else topics[r.topic_id].understanding = r.level;
    }
    for (const r of visitedRows) {
      if (!topics[r.topic_id]) topics[r.topic_id] = { percent: 10, understanding: null };
      else if (topics[r.topic_id].percent < 10) topics[r.topic_id].percent = 10;
    }

    return NextResponse.json({ success: true, data: { topics } });
  } catch (err) {
    return NextResponse.json({ success: false, error: { code: "QUERY_ERROR", message: err instanceof Error ? err.message : String(err) } }, { status: 500 });
  }
}

/**
 * POST /api/learn/progress — Mark a section as read / update reading progress
 */
const progressSchema = z.object({
  contentItemId: z.number().int(),
  sectionId: z.string().optional(),
  /** Set to 100 to mark entire content as complete */
  completionPercent: z.number().int().min(0).max(100).optional(),
  /** Seconds spent reading in this session */
  readTimeSeconds: z.number().int().min(0).optional(),
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

  const parsed = progressSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } }, { status: 400 });
  }

  const { contentItemId, sectionId, completionPercent, readTimeSeconds } = parsed.data;

  // Find existing progress
  const [existing] = await db
    .select()
    .from(readingProgress)
    .where(and(eq(readingProgress.userId, userId), eq(readingProgress.contentItemId, contentItemId)))
    .limit(1);

  if (existing) {
    // Update existing progress
    const sectionsRead = (existing.sectionsRead as string[]) ?? [];
    if (sectionId && !sectionsRead.includes(sectionId)) {
      sectionsRead.push(sectionId);
    }

    await db
      .update(readingProgress)
      .set({
        sectionsRead,
        completionPercent: completionPercent ?? existing.completionPercent,
        lastReadAt: new Date(),
        totalReadTimeSeconds: existing.totalReadTimeSeconds + (readTimeSeconds ?? 0),
      })
      .where(eq(readingProgress.id, existing.id));

    return NextResponse.json({ success: true, data: { id: existing.id, sectionsRead, completionPercent: completionPercent ?? existing.completionPercent } });
  } else {
    // Create new progress entry
    const sectionsRead = sectionId ? [sectionId] : [];
    const [created] = await db
      .insert(readingProgress)
      .values({
        userId,
        contentItemId,
        sectionsRead,
        completionPercent: completionPercent ?? 0,
        totalReadTimeSeconds: readTimeSeconds ?? 0,
      })
      .returning();

    return NextResponse.json({ success: true, data: created }, { status: 201 });
  }
}
