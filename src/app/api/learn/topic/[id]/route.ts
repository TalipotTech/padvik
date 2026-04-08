import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { eq, and, sql } from "drizzle-orm";
import { topics, chapters, subjects, standards, boards } from "@/db/schema/curriculum";
import { contentItems } from "@/db/schema/content";
import { questions } from "@/db/schema/questions";
import { readingProgress, userBookmarks } from "@/db/schema/learn";

/**
 * GET /api/learn/topic/[id]
 *
 * Returns everything needed for the Learn page:
 * - Topic with full hierarchy context
 * - All published content items (notes, flashcards, summaries)
 * - Question count for this topic
 * - Related topics (same chapter)
 * - User's reading progress and bookmark status
 * - Previous/next topic for navigation
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  const { id } = await params;
  const topicId = parseInt(id, 10);

  if (isNaN(topicId)) {
    return NextResponse.json(
      { success: false, error: { code: "INVALID_ID", message: "Invalid topic ID" } },
      { status: 400 }
    );
  }

  // Get topic with full hierarchy
  const [topic] = await db
    .select({
      id: topics.id,
      title: topics.title,
      description: topics.description,
      learningObjectives: topics.learningObjectives,
      bloomLevel: topics.bloomLevel,
      estimatedMinutes: topics.estimatedMinutes,
      sortOrder: topics.sortOrder,
      metadata: topics.metadata,
      chapterId: chapters.id,
      chapterNumber: chapters.chapterNumber,
      chapterTitle: chapters.title,
      chapterDescription: chapters.description,
      subjectId: subjects.id,
      subjectName: subjects.name,
      subjectCode: subjects.code,
      grade: standards.grade,
      boardCode: boards.code,
      boardName: boards.name,
    })
    .from(topics)
    .innerJoin(chapters, eq(chapters.id, topics.chapterId))
    .innerJoin(subjects, eq(subjects.id, chapters.subjectId))
    .innerJoin(standards, eq(standards.id, subjects.standardId))
    .innerJoin(boards, eq(boards.id, standards.boardId))
    .where(eq(topics.id, topicId))
    .limit(1);

  if (!topic) {
    return NextResponse.json(
      { success: false, error: { code: "NOT_FOUND", message: "Topic not found" } },
      { status: 404 }
    );
  }

  // Admin/dev: show ALL content. Students: only published.
  const isAdmin = session?.user?.role === "admin" || (process.env.NODE_ENV === "development" && !session);

  const content = isAdmin
    ? await db
        .select()
        .from(contentItems)
        .where(eq(contentItems.topicId, topicId))
        .orderBy(contentItems.contentType, contentItems.createdAt)
    : await db
        .select()
        .from(contentItems)
        .where(and(eq(contentItems.topicId, topicId), eq(contentItems.isPublished, true)))
        .orderBy(contentItems.contentType, contentItems.createdAt);

  // For admin, no separate pending query needed — all content is in `content`
  const pendingContent: typeof content = [];

  // Get question count for this topic
  const [qCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(questions)
    .where(eq(questions.topicId, topicId));

  // Get related topics (same chapter, excluding current)
  const relatedTopics = await db
    .select({ id: topics.id, title: topics.title, sortOrder: topics.sortOrder })
    .from(topics)
    .where(and(eq(topics.chapterId, topic.chapterId), sql`${topics.id} != ${topicId}`))
    .orderBy(topics.sortOrder);

  // Get all topics in this subject for navigation (prev/next)
  const allTopicsInSubject = await db
    .select({
      id: topics.id,
      title: topics.title,
      chapterNumber: chapters.chapterNumber,
      sortOrder: topics.sortOrder,
    })
    .from(topics)
    .innerJoin(chapters, eq(chapters.id, topics.chapterId))
    .where(eq(chapters.subjectId, topic.subjectId))
    .orderBy(chapters.chapterNumber, topics.sortOrder);

  const currentIndex = allTopicsInSubject.findIndex((t) => t.id === topicId);
  const prevTopic = currentIndex > 0 ? allTopicsInSubject[currentIndex - 1] : null;
  const nextTopic = currentIndex < allTopicsInSubject.length - 1 ? allTopicsInSubject[currentIndex + 1] : null;

  // Get user-specific data if logged in
  let progress = null;
  let isBookmarked = false;

  const userId = session?.user?.id ? Number(session.user.id) : (process.env.NODE_ENV === "development" ? 1 : null);
  if (userId) {

    // Reading progress
    for (const ci of content) {
      const [p] = await db
        .select()
        .from(readingProgress)
        .where(and(eq(readingProgress.userId, userId), eq(readingProgress.contentItemId, ci.id)))
        .limit(1);
      if (p) {
        progress = p;
        break;
      }
    }

    // Bookmark status
    const [bm] = await db
      .select({ id: userBookmarks.id })
      .from(userBookmarks)
      .where(and(eq(userBookmarks.userId, userId), eq(userBookmarks.topicId, topicId)))
      .limit(1);
    isBookmarked = !!bm;
  }

  // Get chapter TOC for sidebar
  const chapterTopics = await db
    .select({
      chapterId: chapters.id,
      chapterNumber: chapters.chapterNumber,
      chapterTitle: chapters.title,
      topicId: topics.id,
      topicTitle: topics.title,
      topicSortOrder: topics.sortOrder,
    })
    .from(chapters)
    .innerJoin(topics, eq(topics.chapterId, chapters.id))
    .where(eq(chapters.subjectId, topic.subjectId))
    .orderBy(chapters.chapterNumber, topics.sortOrder);

  // Group into chapter tree
  const chapterTree: Array<{
    id: number;
    number: number;
    title: string;
    topics: Array<{ id: number; title: string; sortOrder: number }>;
  }> = [];

  for (const ct of chapterTopics) {
    let chapter = chapterTree.find((c) => c.id === ct.chapterId);
    if (!chapter) {
      chapter = { id: ct.chapterId, number: ct.chapterNumber, title: ct.chapterTitle, topics: [] };
      chapterTree.push(chapter);
    }
    chapter.topics.push({ id: ct.topicId, title: ct.topicTitle, sortOrder: ct.topicSortOrder });
  }

  return NextResponse.json({
    success: true,
    data: {
      topic: {
        id: topic.id,
        title: topic.title,
        description: topic.description,
        learningObjectives: topic.learningObjectives,
        bloomLevel: topic.bloomLevel,
        estimatedMinutes: topic.estimatedMinutes,
        metadata: topic.metadata,
        chapter: {
          id: topic.chapterId,
          number: topic.chapterNumber,
          title: topic.chapterTitle,
          description: topic.chapterDescription,
        },
        subject: { id: topic.subjectId, name: topic.subjectName, code: topic.subjectCode },
        grade: topic.grade,
        board: { code: topic.boardCode, name: topic.boardName },
      },
      content,
      pendingContent,
      questionCount: qCount?.count ?? 0,
      relatedTopics,
      navigation: { prev: prevTopic, next: nextTopic },
      chapterTree,
      progress,
      isBookmarked,
    },
  });
}
