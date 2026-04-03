import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { standards, subjects, chapters, topics } from "@/db/schema/curriculum";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { SubjectWithChapters, ChapterWithTopics } from "@/types/curriculum";

// ---------------------------------------------------------------------------
// GET /api/boards/[boardId]/subjects?grade=10&stream=Science
// Returns SubjectWithChapters[] — full nested hierarchy for a board+grade
// ---------------------------------------------------------------------------
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ boardId: string }> },
) {
  const { boardId: raw } = await params;
  const boardId = parseInt(raw, 10);
  if (isNaN(boardId)) {
    return NextResponse.json(
      { success: false, error: { code: "INVALID_ID", message: "Invalid board ID" } },
      { status: 400 },
    );
  }

  const url = new URL(req.url);
  const gradeParam = url.searchParams.get("grade");
  if (!gradeParam) {
    return NextResponse.json(
      { success: false, error: { code: "MISSING_PARAM", message: "grade query param is required" } },
      { status: 400 },
    );
  }
  const grade = parseInt(gradeParam, 10);
  if (isNaN(grade) || grade < 1 || grade > 12) {
    return NextResponse.json(
      { success: false, error: { code: "INVALID_PARAM", message: "grade must be 1-12" } },
      { status: 400 },
    );
  }
  const stream = url.searchParams.get("stream") || null;

  // Step 1: Find the standard
  const streamCondition = stream
    ? eq(standards.stream, stream)
    : isNull(standards.stream);

  const [standard] = await db
    .select()
    .from(standards)
    .where(
      and(
        eq(standards.boardId, boardId),
        eq(standards.grade, grade),
        streamCondition,
      ),
    )
    .limit(1);

  if (!standard) {
    return NextResponse.json({ success: true, data: [] });
  }

  // Step 2: Get subjects
  const subjectRows = await db
    .select()
    .from(subjects)
    .where(eq(subjects.standardId, standard.id))
    .orderBy(subjects.name);

  if (subjectRows.length === 0) {
    return NextResponse.json({ success: true, data: [] });
  }

  const subjectIds = subjectRows.map((s) => s.id);

  // Step 3: Get chapters
  const chapterRows = await db
    .select()
    .from(chapters)
    .where(inArray(chapters.subjectId, subjectIds))
    .orderBy(chapters.sortOrder);

  const chapterIds = chapterRows.map((c) => c.id);

  // Step 4: Get topics
  const topicRows = chapterIds.length > 0
    ? await db
        .select()
        .from(topics)
        .where(inArray(topics.chapterId, chapterIds))
        .orderBy(topics.sortOrder)
    : [];

  // Step 5: Assemble hierarchy in memory
  const topicsByChapter = new Map<number, typeof topicRows>();
  for (const t of topicRows) {
    const list = topicsByChapter.get(t.chapterId) ?? [];
    list.push(t);
    topicsByChapter.set(t.chapterId, list);
  }

  const chaptersBySubject = new Map<number, ChapterWithTopics[]>();
  for (const ch of chapterRows) {
    const list = chaptersBySubject.get(ch.subjectId) ?? [];
    list.push({ ...ch, topics: topicsByChapter.get(ch.id) ?? [] });
    chaptersBySubject.set(ch.subjectId, list);
  }

  const result: SubjectWithChapters[] = subjectRows.map((sub) => ({
    ...sub,
    chapters: chaptersBySubject.get(sub.id) ?? [],
  }));

  return NextResponse.json({ success: true, data: result });
}
