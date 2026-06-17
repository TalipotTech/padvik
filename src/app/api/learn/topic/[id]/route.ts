import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { eq, and, sql } from "drizzle-orm";
import { topics, chapters, subjects, standards, boards } from "@/db/schema/curriculum";
import { contentItems } from "@/db/schema/content";
import { questions } from "@/db/schema/questions";
import { readingProgress, userBookmarks, topicUnderstanding } from "@/db/schema/learn";

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
      // Pull the session label alongside the class so the Playground
      // breadcrumb can show "CBSE · Class 10 · 2026-27" — otherwise content
      // authored for 2025-26 and 2026-27 looks identical in the UI.
      academicYear: standards.academicYear,
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

  // Admin/dev: show ALL content. Students: only published + quality-gated.
  const isAdmin = session?.user?.role === "admin" || (process.env.NODE_ENV === "development" && !session);

  // Hide low-quality / flagged / AI-refusal bodies from students so they
  // never see "this topic is not covered in the provided chapter" text.
  // These same rows are surfaced to admins via pendingContent for review.
  const studentQualityFilter = sql`
    ${contentItems.isPublished} = true
    AND ${contentItems.reviewStatus} != 'needs_review'
    AND ${contentItems.reviewStatus} != 'rejected'
    AND (${contentItems.qualityScore} IS NULL OR ${contentItems.qualityScore}::decimal >= 0.5)
    AND ${contentItems.body} NOT ILIKE '%is not covered in%'
    AND ${contentItems.body} NOT ILIKE '%not covered in the provided%'
    AND ${contentItems.body} NOT ILIKE '%does not appear in the%chapter%'
    AND ${contentItems.body} NOT ILIKE '%cannot find%in the provided%'
    AND ${contentItems.body} NOT ILIKE '%the provided text does not%'
    AND length(${contentItems.body}) > 100
  `;

  // Exclude 'foundation' content — that's shown only in the popup
  const content = isAdmin
    ? await db
        .select()
        .from(contentItems)
        .where(and(eq(contentItems.topicId, topicId), sql`${contentItems.contentType} != 'foundation'`))
        .orderBy(contentItems.contentType, contentItems.createdAt)
    : await db
        .select()
        .from(contentItems)
        .where(and(
          eq(contentItems.topicId, topicId),
          sql`${contentItems.contentType} != 'foundation'`,
          studentQualityFilter,
        ))
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

  // Get per-topic progress for all topics in this subject (for sidebar indicators)
  const topicProgressMap: Record<number, { percent: number; understanding: string | null }> = {};
  if (userId) {
    // Reading progress per topic
    const progressRows = await db.execute<{
      topic_id: number; completion_percent: number;
    }>(sql`
      SELECT ci.topic_id, MAX(rp.completion_percent) AS completion_percent
      FROM reading_progress rp
      JOIN content_items ci ON ci.id = rp.content_item_id
      JOIN chapters ch ON ch.id = (SELECT chapter_id FROM topics WHERE id = ci.topic_id)
      WHERE rp.user_id = ${userId} AND ch.subject_id = ${topic.subjectId}
      GROUP BY ci.topic_id
    `);
    for (const row of progressRows) {
      topicProgressMap[row.topic_id] = { percent: row.completion_percent ?? 0, understanding: null };
    }

    // Understanding levels
    const understandingRows = await db.execute<{
      topic_id: number; understanding_level: string;
    }>(sql`
      SELECT tu.topic_id, tu.understanding_level
      FROM topic_understanding tu
      JOIN topics t ON t.id = tu.topic_id
      JOIN chapters ch ON ch.id = t.chapter_id
      WHERE tu.user_id = ${userId} AND ch.subject_id = ${topic.subjectId}
    `);
    for (const row of understandingRows) {
      if (!topicProgressMap[row.topic_id]) {
        topicProgressMap[row.topic_id] = { percent: 0, understanding: row.understanding_level };
      } else {
        topicProgressMap[row.topic_id].understanding = row.understanding_level;
      }
    }

    // Also mark topics that have notes/chats/videos as "visited" (at least 10%)
    const visitedRows = await db.execute<{ topic_id: number }>(sql`
      SELECT DISTINCT topic_id FROM (
        SELECT topic_id FROM user_notes WHERE user_id = ${userId} AND topic_id IS NOT NULL
        UNION
        SELECT topic_id FROM topic_conversations WHERE user_id = ${userId}
        UNION
        SELECT topic_id FROM user_videos WHERE user_id = ${userId}
      ) visited
      JOIN topics t ON t.id = visited.topic_id
      JOIN chapters ch ON ch.id = t.chapter_id
      WHERE ch.subject_id = ${topic.subjectId}
    `);
    for (const row of visitedRows) {
      if (!topicProgressMap[row.topic_id]) {
        topicProgressMap[row.topic_id] = { percent: 10, understanding: null };
      } else if (topicProgressMap[row.topic_id].percent < 10) {
        topicProgressMap[row.topic_id].percent = 10;
      }
    }
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
    topics: Array<{ id: number; title: string; sortOrder: number; progress: number; understanding: string | null }>;
  }> = [];

  for (const ct of chapterTopics) {
    let chapter = chapterTree.find((c) => c.id === ct.chapterId);
    if (!chapter) {
      chapter = { id: ct.chapterId, number: ct.chapterNumber, title: ct.chapterTitle, topics: [] };
      chapterTree.push(chapter);
    }
    const tp = topicProgressMap[ct.topicId];
    chapter.topics.push({
      id: ct.topicId,
      title: ct.topicTitle,
      sortOrder: ct.topicSortOrder,
      progress: tp?.percent ?? 0,
      understanding: tp?.understanding ?? null,
    });
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
        academicYear: topic.academicYear,
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
