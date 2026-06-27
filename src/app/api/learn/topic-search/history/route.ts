import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { eq, and, sql } from "drizzle-orm";
import { topicSearchHistory } from "@/db/schema/learning-path";

/**
 * GET    /api/learn/topic-search/history        — recent searches, de-duped
 * DELETE /api/learn/topic-search/history[?id=]  — clear one row / all
 *
 * History is an append-only log; we de-dupe on read (DISTINCT ON matched_topic
 * + query) so the timeline stays intact. Rejected rows are hidden.
 */

async function getUserId(): Promise<number | null> {
  try {
    const s = await auth();
    const n = s?.user?.id ? Number(s.user.id) : NaN;
    if (Number.isFinite(n)) return n;
  } catch {
    /* auth failed */
  }
  // Non-numeric (e.g. demo login) or no session → dev fallback.
  if (process.env.NODE_ENV === "development") return 1;
  return null;
}

export async function GET(request: NextRequest) {
  const userId = await getUserId();
  if (!userId) {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Login required" } },
      { status: 401 }
    );
  }

  const limitParam = request.nextUrl.searchParams.get("limit");
  const limit = Math.min(Math.max(parseInt(limitParam ?? "20", 10) || 20, 1), 50);

  // DISTINCT ON the de-dupe key, keeping the most-recent row per key, then
  // order the final list recent-first. Enrich with topic + subject titles.
  const rows = await db.execute<{
    id: number;
    query: string;
    matched_topic_id: number | null;
    topic_title: string | null;
    subject_name: string | null;
    result_count: number;
    created_at: string;
  }>(sql`
    SELECT id, query, matched_topic_id, topic_title, subject_name, result_count, created_at
    FROM (
      SELECT DISTINCT ON (COALESCE(h.matched_topic_id::text, h.query))
        h.id,
        h.query,
        h.matched_topic_id,
        t.title AS topic_title,
        s.name AS subject_name,
        h.result_count,
        h.created_at
      FROM topic_search_history h
      LEFT JOIN topics t ON t.id = h.matched_topic_id
      LEFT JOIN chapters ch ON ch.id = t.chapter_id
      LEFT JOIN subjects s ON s.id = ch.subject_id
      WHERE h.user_id = ${userId}
        AND h.was_rejected = false
      ORDER BY COALESCE(h.matched_topic_id::text, h.query), h.created_at DESC
    ) deduped
    ORDER BY created_at DESC
    LIMIT ${limit}
  `);

  return NextResponse.json({
    success: true,
    data: {
      history: [...rows].map((r) => ({
        id: r.id,
        query: r.query,
        matchedTopicId: r.matched_topic_id,
        topicTitle: r.topic_title,
        subjectName: r.subject_name,
        resultCount: r.result_count,
        createdAt: r.created_at,
      })),
    },
  });
}

export async function DELETE(request: NextRequest) {
  const userId = await getUserId();
  if (!userId) {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Login required" } },
      { status: 401 }
    );
  }

  const idParam = request.nextUrl.searchParams.get("id");

  if (idParam) {
    const id = parseInt(idParam, 10);
    if (Number.isNaN(id)) {
      return NextResponse.json(
        { success: false, error: { code: "INVALID_ID", message: "Invalid id" } },
        { status: 400 }
      );
    }
    await db
      .delete(topicSearchHistory)
      .where(and(eq(topicSearchHistory.id, id), eq(topicSearchHistory.userId, userId)));
  } else {
    await db.delete(topicSearchHistory).where(eq(topicSearchHistory.userId, userId));
  }

  return NextResponse.json({ success: true, data: { cleared: true } });
}
