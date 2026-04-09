import { NextResponse } from "next/server";
import { db } from "@/db";
import { boardNotifications } from "@/db/schema/notifications";
import { boards } from "@/db/schema/curriculum";
import { eq, desc } from "drizzle-orm";
import { getRedisConnection } from "@/lib/redis";

const CACHE_KEY = "padvik:breaking-notifications";
const CACHE_TTL = 300; // 5 minutes

export async function GET() {
  try {
    // Try Redis cache first
    try {
      const redis = getRedisConnection();
      const cached = await redis.get(CACHE_KEY);
      if (cached) {
        return NextResponse.json({
          success: true,
          data: JSON.parse(cached),
        });
      }
    } catch {
      // Redis unavailable — fall through to DB
    }

    const notifications = await db
      .select({
        id: boardNotifications.id,
        boardId: boardNotifications.boardId,
        boardCode: boards.code,
        boardName: boards.name,
        title: boardNotifications.title,
        slug: boardNotifications.slug,
        category: boardNotifications.category,
        summary: boardNotifications.summary,
        sourceUrl: boardNotifications.sourceUrl,
        pdfUrl: boardNotifications.pdfUrl,
        priority: boardNotifications.priority,
        isBreaking: boardNotifications.isBreaking,
        publishedAt: boardNotifications.publishedAt,
      })
      .from(boardNotifications)
      .innerJoin(boards, eq(boardNotifications.boardId, boards.id))
      .where(eq(boardNotifications.isBreaking, true))
      .orderBy(desc(boardNotifications.publishedAt))
      .limit(5);

    // Cache in Redis
    try {
      const redis = getRedisConnection();
      await redis.setex(CACHE_KEY, CACHE_TTL, JSON.stringify(notifications));
    } catch {
      // Non-critical
    }

    return NextResponse.json({ success: true, data: notifications });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: { code: "QUERY_ERROR", message } },
      { status: 500 }
    );
  }
}
