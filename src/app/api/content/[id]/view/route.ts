import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { creatorContent, contentViews } from "@/db/schema/creators";
import { eq, and, sql, gt } from "drizzle-orm";

// POST /api/content/[id]/view — Track a content view
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const { id } = await params;
  const contentId = Number(id);
  const userId = session ? Number(session.user.id) : null;

  // Get content to check existence and get creator_id
  const [content] = await db.select({ id: creatorContent.id, creatorId: creatorContent.creatorId })
    .from(creatorContent).where(eq(creatorContent.id, contentId)).limit(1);
  if (!content) return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "Content not found" } }, { status: 404 });

  let body: { watchedSeconds?: number; classroomId?: number } = {};
  try { body = await request.json(); } catch { /* empty body ok */ }

  // Rate limit: max 1 view per user per content per 5 min
  if (userId) {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
    const [recent] = await db.select({ id: contentViews.id })
      .from(contentViews)
      .where(and(
        eq(contentViews.contentId, contentId),
        eq(contentViews.userId, userId),
        gt(contentViews.createdAt, fiveMinAgo)
      ))
      .limit(1);

    if (recent) {
      // Update existing view (extend watch time)
      if (body.watchedSeconds) {
        await db.update(contentViews).set({
          watchedSeconds: body.watchedSeconds,
          completed: (body.watchedSeconds || 0) > 300, // >5 min = completed
          updatedAt: new Date(),
        }).where(eq(contentViews.id, recent.id));
      }
      return NextResponse.json({ success: true, data: { updated: true } });
    }
  }

  // Insert new view
  await db.insert(contentViews).values({
    contentId,
    userId,
    creatorId: content.creatorId,
    classroomId: body.classroomId ?? null,
    watchedSeconds: body.watchedSeconds ?? 0,
  });

  // Increment view count
  await db.update(creatorContent).set({
    viewCount: sql`${creatorContent.viewCount} + 1`,
  }).where(eq(creatorContent.id, contentId));

  return NextResponse.json({ success: true, data: { recorded: true } }, { status: 201 });
}
