import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { standards, subjects, chapters, topics } from "@/db/schema/curriculum";
import { and, eq, inArray, isNull, desc } from "drizzle-orm";
import type { SubjectWithChapters, ChapterWithTopics } from "@/types/curriculum";
import { ACADEMIC_YEAR_REGEX } from "@/lib/academic-year";

// ---------------------------------------------------------------------------
// GET /api/boards/[boardId]/subjects?grade=10&stream=Science&academicYear=2026-27
//
// Returns SubjectWithChapters[] — full nested hierarchy for a board+grade.
//
// The standards table is keyed on (boardId, grade, stream, academicYear), so
// the same board+grade can have multiple rows (e.g. CBSE Class 10 exists for
// both 2025-26 and 2026-27 during the rollover window). Before this route
// took `academicYear`, the `.limit(1)` here silently picked whichever row
// Postgres returned first — usually the oldest — and students viewing
// 2026-27 content saw 2025-26 chapters. Now:
//   - when `academicYear` is passed, we filter to that session exactly;
//   - when it's omitted, we order by academicYear DESC so the newest session
//     wins deterministically. Callers that want a specific session must pass
//     it explicitly.
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
  const academicYearParam = url.searchParams.get("academicYear");
  const academicYear =
    academicYearParam && ACADEMIC_YEAR_REGEX.test(academicYearParam)
      ? academicYearParam
      : null;

  // Step 1: Find the standard. When academicYear is specified, we filter on
  // it — otherwise we DESC-order by academic_year so the newest session wins
  // (see block comment at top of the file for why a deterministic default
  // matters here).
  const streamCondition = stream
    ? eq(standards.stream, stream)
    : isNull(standards.stream);

  const standardConditions = [
    eq(standards.boardId, boardId),
    eq(standards.grade, grade),
    streamCondition,
  ];
  if (academicYear) {
    standardConditions.push(eq(standards.academicYear, academicYear));
  }

  const [standard] = await db
    .select()
    .from(standards)
    .where(and(...standardConditions))
    .orderBy(desc(standards.academicYear))
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
