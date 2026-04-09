import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { z } from "zod/v4";
import { db } from "@/db";
import { boardNotifications } from "@/db/schema/notifications";
import { boards } from "@/db/schema/curriculum";
import { eq, sql, desc } from "drizzle-orm";
import { scrapeNotifications } from "@/lib/scraper/notification-scraper";

/** GET — notification stats per board for admin dashboard */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Admin access required" } },
      { status: 403 }
    );
  }

  try {
    // Stats per board
    const boardStats = await db
      .select({
        boardId: boards.id,
        boardCode: boards.code,
        boardName: boards.name,
        total: sql<number>`count(*)::int`,
        aiProcessed: sql<number>`count(*) FILTER (WHERE ${boardNotifications.aiProcessed} = true)::int`,
        breaking: sql<number>`count(*) FILTER (WHERE ${boardNotifications.isBreaking} = true)::int`,
        latestDate: sql<string>`max(${boardNotifications.publishedAt})`,
        latestScrape: sql<string>`max(${boardNotifications.scrapedAt})`,
      })
      .from(boards)
      .leftJoin(boardNotifications, eq(boards.id, boardNotifications.boardId))
      .groupBy(boards.id, boards.code, boards.name)
      .orderBy(desc(sql`count(*)`));

    // Overall totals
    const [totals] = await db
      .select({
        total: sql<number>`count(*)::int`,
        aiProcessed: sql<number>`count(*) FILTER (WHERE ${boardNotifications.aiProcessed} = true)::int`,
        breaking: sql<number>`count(*) FILTER (WHERE ${boardNotifications.isBreaking} = true)::int`,
      })
      .from(boardNotifications);

    // Recent 5 scrape entries
    const recent = await db
      .select({
        id: boardNotifications.id,
        boardCode: boards.code,
        title: boardNotifications.title,
        category: boardNotifications.category,
        aiProcessed: boardNotifications.aiProcessed,
        scrapedAt: boardNotifications.scrapedAt,
      })
      .from(boardNotifications)
      .innerJoin(boards, eq(boardNotifications.boardId, boards.id))
      .orderBy(desc(boardNotifications.scrapedAt))
      .limit(5);

    return NextResponse.json({
      success: true,
      data: {
        totals: totals ?? { total: 0, aiProcessed: 0, breaking: 0 },
        boards: boardStats,
        recent,
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

const scrapeSchema = z.object({
  boardCode: z.string().optional(),
});

/** POST — trigger a scrape (runs synchronously for admin convenience) */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Admin access required" } },
      { status: 403 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const parsed = scrapeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } },
      { status: 400 }
    );
  }

  try {
    const result = await scrapeNotifications(parsed.data.boardCode);

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: { code: "SCRAPE_ERROR", message } },
      { status: 500 }
    );
  }
}

/** DELETE — purge notifications for a board (admin cleanup) */
export async function DELETE(request: NextRequest) {
  const session = await auth();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Admin access required" } },
      { status: 403 }
    );
  }

  const boardCode = request.nextUrl.searchParams.get("board");
  if (!boardCode) {
    return NextResponse.json(
      { success: false, error: { code: "VALIDATION_ERROR", message: "board query param required" } },
      { status: 400 }
    );
  }

  try {
    const [board] = await db
      .select({ id: boards.id })
      .from(boards)
      .where(eq(boards.code, boardCode))
      .limit(1);

    if (!board) {
      return NextResponse.json(
        { success: false, error: { code: "NOT_FOUND", message: `Board ${boardCode} not found` } },
        { status: 404 }
      );
    }

    const result = await db
      .delete(boardNotifications)
      .where(eq(boardNotifications.boardId, board.id))
      .returning({ id: boardNotifications.id });

    return NextResponse.json({
      success: true,
      data: { deleted: result.length },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: { code: "DELETE_ERROR", message } },
      { status: 500 }
    );
  }
}
