import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { boardNotifications } from "@/db/schema/notifications";
import { boards } from "@/db/schema/curriculum";
import { eq, desc, and, ne } from "drizzle-orm";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  try {
    const result = await db
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
        affectedSubjects: boardNotifications.affectedSubjects,
        priority: boardNotifications.priority,
        isBreaking: boardNotifications.isBreaking,
        publishedAt: boardNotifications.publishedAt,
        createdAt: boardNotifications.createdAt,
      })
      .from(boardNotifications)
      .innerJoin(boards, eq(boardNotifications.boardId, boards.id))
      .where(eq(boardNotifications.slug, slug))
      .limit(1);

    if (result.length === 0) {
      return NextResponse.json(
        { success: false, error: { code: "NOT_FOUND", message: "Notification not found" } },
        { status: 404 }
      );
    }

    const notification = result[0];

    // Fetch related notifications (same board, same category)
    const related = await db
      .select({
        id: boardNotifications.id,
        title: boardNotifications.title,
        slug: boardNotifications.slug,
        category: boardNotifications.category,
        publishedAt: boardNotifications.publishedAt,
      })
      .from(boardNotifications)
      .where(
        and(
          eq(boardNotifications.boardId, notification.boardId),
          ne(boardNotifications.id, notification.id)
        )
      )
      .orderBy(desc(boardNotifications.publishedAt))
      .limit(5);

    return NextResponse.json({
      success: true,
      data: { notification, related },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: { code: "QUERY_ERROR", message } },
      { status: 500 }
    );
  }
}
