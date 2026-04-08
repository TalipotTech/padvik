import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { userBookmarks } from "@/db/schema/learn";
import { eq, and, desc } from "drizzle-orm";
import { topics, chapters, subjects } from "@/db/schema/curriculum";
import { z } from "zod/v4";

/**
 * GET /api/learn/bookmark — List user's bookmarks
 * POST /api/learn/bookmark — Toggle bookmark on a topic
 */
export async function GET(request: NextRequest) {
  let userId: number | null = null;
  try { const s = await auth(); userId = s?.user?.id ? Number(s.user.id) : null; } catch { /* auth failed */ }
  if (!userId && process.env.NODE_ENV === "development") userId = 1;
  if (!userId) {
    return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Login required" } }, { status: 401 });
  }

  const bookmarks = await db
    .select({
      id: userBookmarks.id,
      topicId: userBookmarks.topicId,
      title: userBookmarks.title,
      createdAt: userBookmarks.createdAt,
      topicTitle: topics.title,
      chapterTitle: chapters.title,
      subjectName: subjects.name,
    })
    .from(userBookmarks)
    .innerJoin(topics, eq(topics.id, userBookmarks.topicId))
    .innerJoin(chapters, eq(chapters.id, topics.chapterId))
    .innerJoin(subjects, eq(subjects.id, chapters.subjectId))
    .where(eq(userBookmarks.userId, userId))
    .orderBy(desc(userBookmarks.createdAt));

  return NextResponse.json({ success: true, data: bookmarks });
}

const bookmarkSchema = z.object({
  topicId: z.number().int(),
  title: z.string().optional(),
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

  const parsed = bookmarkSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } }, { status: 400 });
  }

  const { topicId, title } = parsed.data;

  // Toggle: if bookmark exists, remove it; if not, create it
  const [existing] = await db
    .select({ id: userBookmarks.id })
    .from(userBookmarks)
    .where(and(eq(userBookmarks.userId, userId), eq(userBookmarks.topicId, topicId)))
    .limit(1);

  if (existing) {
    await db.delete(userBookmarks).where(eq(userBookmarks.id, existing.id));
    return NextResponse.json({ success: true, data: { bookmarked: false } });
  } else {
    await db.insert(userBookmarks).values({ userId, topicId, title });
    return NextResponse.json({ success: true, data: { bookmarked: true } }, { status: 201 });
  }
}
