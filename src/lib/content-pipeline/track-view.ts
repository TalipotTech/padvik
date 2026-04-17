/**
 * Content view tracking — server-side utility.
 * Called from API routes to track student engagement.
 */

import { db } from "@/db";
import { creatorContent, contentViews } from "@/db/schema/creators";
import { eq, and, sql } from "drizzle-orm";

/**
 * Track a content view. Upserts the content_views record.
 *
 * @param contentId - The content being viewed
 * @param studentId - The student viewing it
 * @param classroomId - Which classroom context (null = organic/browse)
 * @param watchedSeconds - How many seconds watched so far
 * @param completed - Whether the student finished the content
 */
export async function trackContentView(
  contentId: number,
  studentId: number,
  classroomId?: number | null,
  watchedSeconds?: number,
  completed?: boolean
): Promise<void> {
  // Get content for creator_id and duration
  const [content] = await db.select({
    creatorId: creatorContent.creatorId,
    durationSeconds: creatorContent.durationSeconds,
  }).from(creatorContent).where(eq(creatorContent.id, contentId)).limit(1);

  if (!content) return;

  const watched = watchedSeconds ?? 0;

  // Auto-detect completion: watched > 80% of duration
  let isCompleted = completed ?? false;
  if (!isCompleted && content.durationSeconds && content.durationSeconds > 0) {
    isCompleted = watched >= content.durationSeconds * 0.8;
  }

  // Upsert: find existing view for this content+student
  const [existing] = await db.select({
    id: contentViews.id,
    watchedSeconds: contentViews.watchedSeconds,
    completed: contentViews.completed,
  })
    .from(contentViews)
    .where(and(
      eq(contentViews.contentId, contentId),
      eq(contentViews.userId, studentId)
    ))
    .limit(1);

  if (existing) {
    // Update — only increase watched seconds, never decrease
    const newWatched = Math.max(existing.watchedSeconds, watched);
    const newCompleted = isCompleted || existing.completed;

    await db.update(contentViews).set({
      watchedSeconds: newWatched,
      completed: newCompleted,
      updatedAt: new Date(),
    }).where(eq(contentViews.id, existing.id));
  } else {
    // New view — insert
    await db.insert(contentViews).values({
      contentId,
      userId: studentId,
      creatorId: content.creatorId,
      classroomId: classroomId ?? null,
      watchedSeconds: watched,
      completed: isCompleted,
    });

    // Increment view count (only on first view)
    await db.update(creatorContent).set({
      viewCount: sql`${creatorContent.viewCount} + 1`,
    }).where(eq(creatorContent.id, contentId));
  }
}
