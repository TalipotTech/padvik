import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { eq, and, asc } from "drizzle-orm";
import { boards, standards, subjects, chapters, topics } from "@/db/schema/curriculum";

/**
 * GET /api/admin/curriculum-explorer?boardCode=CBSE&grade=10
 *
 * Returns the full nested curriculum hierarchy for a board,
 * with pipeline metadata (source PDF, AI model, parse date) from contentPipelineLogs.
 */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Admin access required" } },
      { status: 403 }
    );
  }

  const boardCode = request.nextUrl.searchParams.get("boardCode") ?? "CBSE";
  const gradeParam = request.nextUrl.searchParams.get("grade");
  const gradeFilter = gradeParam ? parseInt(gradeParam, 10) : null;

  try {
    // Get the board
    const [board] = await db
      .select()
      .from(boards)
      .where(eq(boards.code, boardCode))
      .limit(1);

    if (!board) {
      return NextResponse.json(
        { success: false, error: { code: "NOT_FOUND", message: `Board ${boardCode} not found` } },
        { status: 404 }
      );
    }

    // Get standards for this board
    const standardsQuery = gradeFilter
      ? db.select().from(standards).where(and(eq(standards.boardId, board.id), eq(standards.grade, gradeFilter))).orderBy(asc(standards.grade))
      : db.select().from(standards).where(eq(standards.boardId, board.id)).orderBy(asc(standards.grade));

    const standardRows = await standardsQuery;

    // Deduplicate standards by grade+stream (there may be duplicates from seeding)
    const seenGradeStreams = new Set<string>();
    const uniqueStandards = standardRows.filter((s) => {
      const key = `${s.grade}-${s.stream ?? ""}`;
      if (seenGradeStreams.has(key)) return false;
      seenGradeStreams.add(key);
      return true;
    });

    // Build the full hierarchy for each standard
    const gradesData = [];

    for (const standard of uniqueStandards) {
      // Get subjects for this standard
      const subjectRows = await db
        .select()
        .from(subjects)
        .where(eq(subjects.standardId, standard.id))
        .orderBy(asc(subjects.name));

      const subjectsData = [];

      for (const subject of subjectRows) {
        // Get chapters + topic counts
        const chapterRows = await db
          .select({
            id: chapters.id,
            chapterNumber: chapters.chapterNumber,
            title: chapters.title,
            description: chapters.description,
            estimatedHours: chapters.estimatedHours,
            weightagePct: chapters.weightagePct,
            sortOrder: chapters.sortOrder,
            createdAt: chapters.createdAt,
          })
          .from(chapters)
          .where(eq(chapters.subjectId, subject.id))
          .orderBy(asc(chapters.chapterNumber));

        const chaptersWithTopics = [];
        let totalTopics = 0;

        for (const chapter of chapterRows) {
          const topicRows = await db
            .select({
              id: topics.id,
              title: topics.title,
              description: topics.description,
              bloomLevel: topics.bloomLevel,
              estimatedMinutes: topics.estimatedMinutes,
              sortOrder: topics.sortOrder,
            })
            .from(topics)
            .where(eq(topics.chapterId, chapter.id))
            .orderBy(asc(topics.sortOrder));

          totalTopics += topicRows.length;

          chaptersWithTopics.push({
            ...chapter,
            topicsCount: topicRows.length,
            topics: topicRows,
          });
        }

        // Read provenance from subject metadata (stored by syllabus-inserter)
        const meta = (subject.metadata as Record<string, unknown>) ?? {};
        const sourcePdf = (meta.sourcePdf as string) ?? (meta.sourceUrl as string) ?? null;
        const aiModel = (meta.aiModel as string) ?? null;
        const parsedAt = (meta.parsedAt as string) ?? null;
        const reviewStatus = (meta.reviewStatus as string) ?? null;

        subjectsData.push({
          id: subject.id,
          name: subject.name,
          code: subject.code,
          maxMarks: subject.maxMarks,
          subjectType: subject.subjectType,
          chaptersCount: chapterRows.length,
          topicsCount: totalTopics,
          sourcePdf,
          aiModel,
          parsedAt,
          reviewStatus,
          chapters: chaptersWithTopics,
        });
      }

      gradesData.push({
        standardId: standard.id,
        grade: standard.grade,
        stream: standard.stream,
        totalSubjects: subjectsData.length,
        subjectsWithChapters: subjectsData.filter((s) => s.chaptersCount > 0).length,
        totalChapters: subjectsData.reduce((sum, s) => sum + s.chaptersCount, 0),
        totalTopics: subjectsData.reduce((sum, s) => sum + s.topicsCount, 0),
        subjects: subjectsData,
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        board: { id: board.id, code: board.code, name: board.name },
        grades: gradesData,
        totals: {
          grades: gradesData.length,
          subjects: gradesData.reduce((s, g) => s + g.totalSubjects, 0),
          subjectsWithContent: gradesData.reduce((s, g) => s + g.subjectsWithChapters, 0),
          chapters: gradesData.reduce((s, g) => s + g.totalChapters, 0),
          topics: gradesData.reduce((s, g) => s + g.totalTopics, 0),
        },
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: { code: "QUERY_ERROR", message } },
      { status: 500 }
    );
  }
}
