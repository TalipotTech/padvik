import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { boards, standards, subjects, chapters, topics } from "@/db/schema/curriculum";
import { contentItems } from "@/db/schema/content";
import { and, eq } from "drizzle-orm";

// ---------------------------------------------------------------------------
// GET /api/syllabus/topics/[id] — Topic with full context + content items
// ---------------------------------------------------------------------------
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: raw } = await params;
  const topicId = parseInt(raw, 10);
  if (isNaN(topicId)) {
    return NextResponse.json(
      { success: false, error: { code: "INVALID_ID", message: "Invalid topic ID" } },
      { status: 400 },
    );
  }

  // Join up the hierarchy: topic → chapter → subject → standard → board
  const rows = await db
    .select({
      topic: topics,
      chapter: chapters,
      subject: subjects,
      standard: standards,
      board: boards,
    })
    .from(topics)
    .innerJoin(chapters, eq(topics.chapterId, chapters.id))
    .innerJoin(subjects, eq(chapters.subjectId, subjects.id))
    .innerJoin(standards, eq(subjects.standardId, standards.id))
    .innerJoin(boards, eq(standards.boardId, boards.id))
    .where(eq(topics.id, topicId))
    .limit(1);

  if (rows.length === 0) {
    return NextResponse.json(
      { success: false, error: { code: "NOT_FOUND", message: "Topic not found" } },
      { status: 404 },
    );
  }

  const { topic, chapter, subject, standard, board } = rows[0];

  // Get published content for this topic
  const content = await db
    .select()
    .from(contentItems)
    .where(and(eq(contentItems.topicId, topicId), eq(contentItems.isPublished, true)))
    .orderBy(contentItems.contentType, contentItems.createdAt);

  return NextResponse.json({
    success: true,
    data: {
      topic: { ...topic, chapter, subject, standard, board },
      contentItems: content,
    },
  });
}
