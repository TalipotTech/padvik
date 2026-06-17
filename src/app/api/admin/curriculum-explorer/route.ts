import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { eq, and, asc, desc } from "drizzle-orm";
import { boards, standards, subjects, chapters, topics } from "@/db/schema/curriculum";
import { ACADEMIC_YEAR_REGEX } from "@/lib/academic-year";

/**
 * GET /api/admin/curriculum-explorer?boardCode=CBSE&grade=10&academicYear=2026-27
 *
 * Returns the full nested curriculum hierarchy for a board,
 * with pipeline metadata (source PDF, AI model, parse date) from contentPipelineLogs.
 *
 * `academicYear` is optional — when omitted we return rows across every year
 * the board has, and the UI renders the session tag alongside each grade so
 * 2025-26 and 2026-27 Class 10s don't get silently merged.
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
  const academicYearParam = request.nextUrl.searchParams.get("academicYear");
  const academicYearFilter =
    academicYearParam && ACADEMIC_YEAR_REGEX.test(academicYearParam)
      ? academicYearParam
      : null;

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

    // Get standards for this board. The query is AND-composed so callers can
    // mix grade + academicYear filters freely (both optional, both indexed via
    // the composite UNIQUE on standards).
    const standardsConditions = [eq(standards.boardId, board.id)];
    if (gradeFilter) standardsConditions.push(eq(standards.grade, gradeFilter));
    if (academicYearFilter)
      standardsConditions.push(eq(standards.academicYear, academicYearFilter));

    const standardRows = await db
      .select()
      .from(standards)
      .where(and(...standardsConditions))
      // Newest year first so the default (unfiltered) view leads with the
      // active session's classes; ties broken by grade ascending.
      .orderBy(desc(standards.academicYear), asc(standards.grade));

    // Deduplicate standards by grade+stream+academicYear. Grade+stream alone
    // collapses 2025-26 and 2026-27 Class 10s into a single row, which would
    // silently hide one session's subjects from the admin tree — include the
    // year so every distinct session shows up.
    const seenGradeStreams = new Set<string>();
    const uniqueStandards = standardRows.filter((s) => {
      const key = `${s.grade}-${s.stream ?? ""}-${s.academicYear}`;
      if (seenGradeStreams.has(key)) return false;
      seenGradeStreams.add(key);
      return true;
    });

    // Pull the distinct academic years this board has rows for, newest first.
    // Feeds the Academic Year <Select> on the admin explorer so the dropdown
    // only offers sessions that actually have data (vs. hard-coding the full
    // SELECTABLE_ACADEMIC_YEARS list and showing empty years).
    const availableYearRows = await db
      .selectDistinct({ academicYear: standards.academicYear })
      .from(standards)
      .where(eq(standards.boardId, board.id))
      .orderBy(desc(standards.academicYear));
    const availableAcademicYears = availableYearRows.map((r) => r.academicYear);

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

        // Read provenance from subject metadata (stored by syllabus-inserter
        // or ncert-downloader). The two pipelines write different shapes:
        //
        //   CBSE legacy scraper: { sourcePdf, sourceUrl, aiModel, parsedAt,
        //                           reviewStatus, sourceText, … }
        //   NCERT downloader:    { source: "ncert" }   — PDFs live per-chapter
        //
        // We expose `sourceType` so the admin UI can distinguish them and
        // still show NCERT subjects (which lack a subject-level PDF) in
        // anything that previously gated on `sourcePdf !== null`.
        const meta = (subject.metadata as Record<string, unknown>) ?? {};
        const sourcePdf = (meta.sourcePdf as string) ?? (meta.sourceUrl as string) ?? null;
        const aiModel = (meta.aiModel as string) ?? null;
        const parsedAt = (meta.parsedAt as string) ?? null;
        const reviewStatus = (meta.reviewStatus as string) ?? null;
        const sourceType = (meta.source as string) ?? (sourcePdf ? "scraped" : null);

        subjectsData.push({
          id: subject.id,
          name: subject.name,
          code: subject.code,
          maxMarks: subject.maxMarks,
          subjectType: subject.subjectType,
          chaptersCount: chapterRows.length,
          topicsCount: totalTopics,
          sourcePdf,
          sourceType,
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
        academicYear: standard.academicYear,
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
        academicYear: academicYearFilter,
        availableAcademicYears,
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
