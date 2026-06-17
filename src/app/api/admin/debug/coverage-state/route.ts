import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { boards, standards, subjects, chapters, topics } from "@/db/schema/curriculum";
import { contentItems } from "@/db/schema/content";

// ---------------------------------------------------------------------------
// GET /api/admin/debug/coverage-state?boardCode=CBSE&grade=10&subject=Mathematics
//
// Admin-only diagnostic. Given a board+grade+subject, walks every coexisting
// `standards` row (one per academic_year) and dumps:
//   - which academicYear rows exist for this pair
//   - the matching subject row under each standards row
//   - chapter + topic rows (with titles, so we can see placeholder vs real)
//   - per-topic content_items summary (count + sourceType + pdfPath + published)
//
// This is the single-shot answer to "did Bootstrap actually land content under
// the 2026-27 tree, or did it silently dedup against 2025-26 again?"
//
// Same dev-bypass pattern as /api/admin/coverage/run so it's usable in local
// dev without a signed-in admin session.
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  const session = await auth();
  const isAdmin =
    session?.user?.role === "admin" ||
    (!session && process.env.NODE_ENV === "development");
  if (!isAdmin) {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Admin access required" } },
      { status: 403 },
    );
  }

  const url = new URL(req.url);
  const boardCode = url.searchParams.get("boardCode");
  const gradeParam = url.searchParams.get("grade");
  const subjectName = url.searchParams.get("subject");
  if (!boardCode || !gradeParam || !subjectName) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "MISSING_PARAM",
          message: "boardCode, grade, and subject query params are all required",
        },
      },
      { status: 400 },
    );
  }
  const grade = parseInt(gradeParam, 10);
  if (isNaN(grade)) {
    return NextResponse.json(
      { success: false, error: { code: "INVALID_GRADE", message: "grade must be an integer" } },
      { status: 400 },
    );
  }

  // Step 1: board
  const [board] = await db
    .select({ id: boards.id, code: boards.code, name: boards.name })
    .from(boards)
    .where(eq(boards.code, boardCode))
    .limit(1);
  if (!board) {
    return NextResponse.json(
      { success: false, error: { code: "BOARD_NOT_FOUND", message: `No board ${boardCode}` } },
      { status: 404 },
    );
  }

  // Step 2: every standards row for this board+grade (one per academicYear)
  const standardRows = await db
    .select({
      id: standards.id,
      academicYear: standards.academicYear,
      stream: standards.stream,
      isActive: standards.isActive,
    })
    .from(standards)
    .where(and(eq(standards.boardId, board.id), eq(standards.grade, grade)));

  if (standardRows.length === 0) {
    return NextResponse.json({
      success: true,
      data: {
        board,
        grade,
        subjectQuery: subjectName,
        message: "No standards rows for this board+grade combination",
        standards: [],
      },
    });
  }

  // Step 3: for each standards row, find matching subject + walk down
  const perYear = await Promise.all(
    standardRows.map(async (std) => {
      const [subject] = await db
        .select({
          id: subjects.id,
          code: subjects.code,
          name: subjects.name,
          isElective: subjects.isElective,
        })
        .from(subjects)
        .where(
          and(
            eq(subjects.standardId, std.id),
            // case-insensitive match on subject name so "Mathematics" finds
            // "MATHEMATICS" / "mathematics" / "Maths" etc. We use ilike with a
            // wildcard to catch partial matches like "Maths" ↔ "Mathematics".
          ),
        );

      // Fall back to partial/case-insensitive match if exact miss
      const [subjectFuzzy] = subject
        ? [subject]
        : await db
            .select({
              id: subjects.id,
              code: subjects.code,
              name: subjects.name,
              isElective: subjects.isElective,
            })
            .from(subjects)
            .where(eq(subjects.standardId, std.id));

      // Actually, the above isn't filtering by name — let me do it client side
      // to keep the SQL simple. (Drizzle's ilike import is a pain in this
      // small debug route; we pull all subjects for this standard and match
      // by name in JS.)
      const allSubjects = await db
        .select({
          id: subjects.id,
          code: subjects.code,
          name: subjects.name,
          isElective: subjects.isElective,
        })
        .from(subjects)
        .where(eq(subjects.standardId, std.id));

      const needle = subjectName.toLowerCase();
      const match =
        allSubjects.find((s) => s.name.toLowerCase() === needle) ??
        allSubjects.find((s) => s.name.toLowerCase().includes(needle)) ??
        subjectFuzzy ??
        null;

      if (!match) {
        return {
          standardId: std.id,
          academicYear: std.academicYear,
          stream: std.stream,
          isActive: std.isActive,
          subject: null,
          subjectsUnderThisStandard: allSubjects.map((s) => s.name),
          chapters: [],
        };
      }

      // Chapters under this subject
      const chapterRows = await db
        .select({
          id: chapters.id,
          chapterNumber: chapters.chapterNumber,
          title: chapters.title,
        })
        .from(chapters)
        .where(eq(chapters.subjectId, match.id))
        .orderBy(chapters.sortOrder);

      const chapterIds = chapterRows.map((c) => c.id);

      // Topics under those chapters
      const topicRows = chapterIds.length
        ? await db
            .select({
              id: topics.id,
              chapterId: topics.chapterId,
              title: topics.title,
              sortOrder: topics.sortOrder,
            })
            .from(topics)
            .where(inArray(topics.chapterId, chapterIds))
        : [];

      const topicIds = topicRows.map((t) => t.id);

      // Content items under those topics — we pick only the fields a human
      // diagnosing this needs: sourceType + sourceUrl + metadata.pdfPath +
      // isPublished + qualityScore. Full body is omitted (it's huge).
      type ContentRow = {
        id: number;
        topicId: number;
        contentType: string;
        sourceType: string;
        sourceUrl: string | null;
        isPublished: boolean;
        qualityScore: string | null;
        metadata: Record<string, unknown> | null;
      };
      const ciRowsRaw = topicIds.length
        ? await db
            .select({
              id: contentItems.id,
              topicId: contentItems.topicId,
              contentType: contentItems.contentType,
              sourceType: contentItems.sourceType,
              sourceUrl: contentItems.sourceUrl,
              isPublished: contentItems.isPublished,
              qualityScore: contentItems.qualityScore,
              metadata: contentItems.metadata,
            })
            .from(contentItems)
            .where(inArray(contentItems.topicId, topicIds))
        : [];
      // Drizzle types metadata as `unknown`; narrow to the Record shape our
      // diagnostic cares about so the downstream `meta.pdfPath` read is safe.
      const ciRows: ContentRow[] = ciRowsRaw.map((r) => ({
        ...r,
        metadata: (r.metadata as Record<string, unknown> | null) ?? null,
      }));

      const ciByTopic = new Map<number, ContentRow[]>();
      for (const ci of ciRows) {
        const list = ciByTopic.get(ci.topicId) ?? [];
        list.push(ci);
        ciByTopic.set(ci.topicId, list);
      }

      const topicsByChapter = new Map<number, typeof topicRows>();
      for (const t of topicRows) {
        const list = topicsByChapter.get(t.chapterId) ?? [];
        list.push(t);
        topicsByChapter.set(t.chapterId, list);
      }

      const chaptersOut = chapterRows.map((ch) => {
        const chTopics = (topicsByChapter.get(ch.id) ?? []).map((t) => {
          const tci = ciByTopic.get(t.id) ?? [];
          return {
            topicId: t.id,
            title: t.title,
            contentItemCount: tci.length,
            contentItems: tci.map((ci) => ({
              id: ci.id,
              sourceType: ci.sourceType,
              sourceUrl: ci.sourceUrl,
              pdfPath:
                (ci.metadata as Record<string, unknown> | null)?.pdfPath ??
                null,
              isPublished: ci.isPublished,
              qualityScore: ci.qualityScore,
              contentType: ci.contentType,
            })),
          };
        });
        return {
          chapterId: ch.id,
          chapterNumber: ch.chapterNumber,
          title: ch.title,
          topics: chTopics,
        };
      });

      return {
        standardId: std.id,
        academicYear: std.academicYear,
        stream: std.stream,
        isActive: std.isActive,
        subject: {
          id: match.id,
          code: match.code,
          name: match.name,
        },
        subjectsUnderThisStandard: allSubjects.map((s) => ({
          id: s.id,
          name: s.name,
          code: s.code,
        })),
        chapters: chaptersOut,
      };
    }),
  );

  return NextResponse.json({
    success: true,
    data: {
      board,
      grade,
      subjectQuery: subjectName,
      standards: perYear.sort((a, b) =>
        a.academicYear < b.academicYear ? 1 : -1,
      ),
    },
  });
}
