import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { creatorContent, contentViews } from "@/db/schema/creators";
import { eq, and, sql } from "drizzle-orm";

/**
 * POST /api/content/[id]/view — Track/update a content view
 *
 * Called:
 * - When student opens content (watchedSeconds = 0) → creates initial view
 * - Every 30s while watching video (heartbeat) → updates watchedSeconds
 * - When student finishes (completed = true)
 *
 * The classroomId scopes the view: Tuition A only sees views from their classroom.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const { id } = await params;
  const contentId = Number(id);
  const userId = session ? Number(session.user.id) : null;

  if (!userId) {
    return NextResponse.json({ success: true, data: { tracked: false, reason: "anonymous" } });
  }

  // Get content to find creator_id and duration
  const [content] = await db.select({
    id: creatorContent.id,
    creatorId: creatorContent.creatorId,
    durationSeconds: creatorContent.durationSeconds,
  }).from(creatorContent).where(eq(creatorContent.id, contentId)).limit(1);

  if (!content) {
    return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "Content not found" } }, { status: 404 });
  }

  let body: { watchedSeconds?: number; classroomId?: number; completed?: boolean } = {};
  try { body = await request.json(); } catch { /* empty body ok */ }

  const watchedSeconds = body.watchedSeconds ?? 0;
  const classroomId = body.classroomId ?? null;

  // Determine completion: explicit flag OR watched > 80% of duration
  let completed = body.completed ?? false;
  if (!completed && content.durationSeconds && content.durationSeconds > 0) {
    completed = watchedSeconds >= content.durationSeconds * 0.8;
  }
  // For non-video content, opening it = completed
  if (!content.durationSeconds && watchedSeconds === 0) {
    completed = true;
  }

  // Upsert: find existing view for this content+student (any time, not rate-limited)
  const [existing] = await db.select({ id: contentViews.id, watchedSeconds: contentViews.watchedSeconds })
    .from(contentViews)
    .where(and(
      eq(contentViews.contentId, contentId),
      eq(contentViews.userId, userId)
    ))
    .limit(1);

  if (existing) {
    // Update — only increase watchedSeconds (never decrease), update completed
    const newWatched = Math.max(existing.watchedSeconds, watchedSeconds);
    await db.update(contentViews).set({
      watchedSeconds: newWatched,
      completed: completed || undefined, // only set to true, never back to false
      classroomId: classroomId ?? undefined, // keep existing if not provided
      updatedAt: new Date(),
    }).where(eq(contentViews.id, existing.id));

    return NextResponse.json({ success: true, data: { updated: true, watchedSeconds: newWatched, completed } });
  }

  // New view — insert and increment view count
  await db.insert(contentViews).values({
    contentId,
    userId,
    creatorId: content.creatorId,
    classroomId,
    watchedSeconds,
    completed,
  });

  // Increment view count on content (only on first view, not heartbeats)
  await db.update(creatorContent).set({
    viewCount: sql`${creatorContent.viewCount} + 1`,
  }).where(eq(creatorContent.id, contentId));

  return NextResponse.json({ success: true, data: { recorded: true, watchedSeconds, completed } }, { status: 201 });
}
