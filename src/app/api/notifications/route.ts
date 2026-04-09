import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { boardNotifications } from "@/db/schema/notifications";
import { boards } from "@/db/schema/curriculum";
import { eq, desc, and, sql, type SQL } from "drizzle-orm";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const boardId = params.get("board") ? Number(params.get("board")) : null;
  const category = params.get("category");
  const priority = params.get("priority");
  const classNum = params.get("class") ? Number(params.get("class")) : null;
  const limit = Math.min(Number(params.get("limit") ?? 20), 100);
  const offset = Number(params.get("offset") ?? 0);

  try {
    const conditions: SQL[] = [];

    if (boardId) {
      conditions.push(eq(boardNotifications.boardId, boardId));
    }
    if (category) {
      conditions.push(eq(boardNotifications.category, category));
    }
    if (priority) {
      conditions.push(eq(boardNotifications.priority, priority));
    }
    if (classNum) {
      // Show notifications that either match the class OR have no class restriction
      conditions.push(
        sql`(${boardNotifications.affectedClasses} = '{}' OR ${classNum} = ANY(${boardNotifications.affectedClasses}))`
      );
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [notifications, countResult] = await Promise.all([
      db
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
          affectedClasses: boardNotifications.affectedClasses,
          priority: boardNotifications.priority,
          isBreaking: boardNotifications.isBreaking,
          publishedAt: boardNotifications.publishedAt,
          createdAt: boardNotifications.createdAt,
        })
        .from(boardNotifications)
        .innerJoin(boards, eq(boardNotifications.boardId, boards.id))
        .where(where)
        .orderBy(desc(boardNotifications.publishedAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(boardNotifications)
        .where(where),
    ]);

    return NextResponse.json({
      success: true,
      data: notifications,
      pagination: {
        total: countResult[0]?.count ?? 0,
        limit,
        offset,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: { code: "QUERY_ERROR", message } },
      { status: 500 }
    );
  }
}
