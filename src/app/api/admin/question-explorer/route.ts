import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { questions, questionPapers } from "@/db/schema/questions";
import { topics, chapters, subjects, standards, boards } from "@/db/schema/curriculum";
import { eq, and, desc, sql, ilike } from "drizzle-orm";

// ---------------------------------------------------------------------------
// GET /api/admin/question-explorer — Browse questions by Board/Grade/Subject
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Admin access required" } },
      { status: 403 }
    );
  }

  const params = request.nextUrl.searchParams;
  const boardCode = params.get("boardCode") ?? "CBSE";
  const gradeFilter = params.get("grade");
  const subjectIdFilter = params.get("subjectId");
  const searchQuery = params.get("search");
  const questionTypeFilter = params.get("questionType");
  const difficultyFilter = params.get("difficulty");

  // Get board
  const [board] = await db
    .select()
    .from(boards)
    .where(eq(boards.code, boardCode))
    .limit(1);

  if (!board) {
    return NextResponse.json({
      success: true,
      data: { board: null, subjects: [], questions: [], stats: {}, papers: [] },
    });
  }

  // Build standard conditions
  const stdConditions = [eq(standards.boardId, board.id)];
  if (gradeFilter) {
    stdConditions.push(eq(standards.grade, parseInt(gradeFilter)));
  }

  // Get subjects with question counts
  const subjectRows = await db
    .select({
      subjectId: subjects.id,
      subjectName: subjects.name,
      subjectCode: subjects.code,
      grade: standards.grade,
      questionCount: sql<number>`count(distinct ${questions.id})::int`,
    })
    .from(subjects)
    .innerJoin(standards, eq(subjects.standardId, standards.id))
    .innerJoin(chapters, eq(chapters.subjectId, subjects.id))
    .innerJoin(topics, eq(topics.chapterId, chapters.id))
    .innerJoin(questions, eq(questions.topicId, topics.id))
    .where(and(...stdConditions))
    .groupBy(subjects.id, subjects.name, subjects.code, standards.grade)
    .orderBy(subjects.name);

  // If a specific subject is selected, get its questions with full hierarchy
  let questionRows: {
    question: typeof questions.$inferSelect;
    topicTitle: string;
    chapterTitle: string;
    chapterNumber: number | null;
  }[] = [];

  if (subjectIdFilter) {
    const qConditions = [eq(chapters.subjectId, parseInt(subjectIdFilter))];
    if (searchQuery) {
      qConditions.push(ilike(questions.questionText, `%${searchQuery}%`));
    }
    if (questionTypeFilter) {
      qConditions.push(eq(questions.questionType, questionTypeFilter));
    }
    if (difficultyFilter) {
      qConditions.push(eq(questions.difficulty, difficultyFilter));
    }

    questionRows = await db
      .select({
        question: questions,
        topicTitle: topics.title,
        chapterTitle: chapters.title,
        chapterNumber: chapters.chapterNumber,
      })
      .from(questions)
      .innerJoin(topics, eq(questions.topicId, topics.id))
      .innerJoin(chapters, eq(topics.chapterId, chapters.id))
      .where(and(...qConditions))
      .orderBy(chapters.chapterNumber, topics.sortOrder, questions.sectionLabel)
      .limit(500);
  }

  // Get question papers for this board/grade
  const paperConditions = [eq(questionPapers.boardId, board.id)];
  if (gradeFilter) {
    const [std] = await db
      .select({ id: standards.id })
      .from(standards)
      .where(and(eq(standards.boardId, board.id), eq(standards.grade, parseInt(gradeFilter))))
      .limit(1);
    if (std) paperConditions.push(eq(questionPapers.standardId, std.id));
  }

  const paperRows = await db
    .select()
    .from(questionPapers)
    .where(and(...paperConditions))
    .orderBy(desc(questionPapers.paperYear));

  // Stats
  const [statsRow] = await db
    .select({
      totalQuestions: sql<number>`count(distinct ${questions.id})::int`,
      totalPapers: sql<number>`count(distinct ${questionPapers.id})::int`,
      mcqCount: sql<number>`count(distinct ${questions.id}) filter (where ${questions.questionType} = 'mcq')::int`,
      shortCount: sql<number>`count(distinct ${questions.id}) filter (where ${questions.questionType} = 'short_answer')::int`,
      longCount: sql<number>`count(distinct ${questions.id}) filter (where ${questions.questionType} = 'long_answer')::int`,
      easyCount: sql<number>`count(distinct ${questions.id}) filter (where ${questions.difficulty} = 'easy')::int`,
      mediumCount: sql<number>`count(distinct ${questions.id}) filter (where ${questions.difficulty} = 'medium')::int`,
      hardCount: sql<number>`count(distinct ${questions.id}) filter (where ${questions.difficulty} = 'hard')::int`,
    })
    .from(questions)
    .innerJoin(topics, eq(questions.topicId, topics.id))
    .innerJoin(chapters, eq(topics.chapterId, chapters.id))
    .innerJoin(subjects, eq(chapters.subjectId, subjects.id))
    .innerJoin(standards, eq(subjects.standardId, standards.id))
    .leftJoin(questionPapers, eq(questions.sourcePaperId, questionPapers.id))
    .where(
      gradeFilter
        ? and(eq(standards.boardId, board.id), eq(standards.grade, parseInt(gradeFilter)))
        : eq(standards.boardId, board.id)
    );

  // Build a paper lookup for source URLs
  const paperMap = new Map<number, { title: string; sourceUrl: string | null; questionCount: number }>();
  for (const p of paperRows) {
    paperMap.set(p.id, { title: p.paperTitle, sourceUrl: p.sourceUrl, questionCount: p.questionCount });
  }

  // Group questions by chapter for the selected subject
  const chapterMap = new Map<
    string,
    {
      chapterNumber: number | null;
      title: string;
      topics: Map<string, { title: string; questions: typeof questionRows }>;
    }
  >();

  for (const row of questionRows) {
    const chKey = row.chapterTitle;
    if (!chapterMap.has(chKey)) {
      chapterMap.set(chKey, {
        chapterNumber: row.chapterNumber,
        title: row.chapterTitle,
        topics: new Map(),
      });
    }
    const chapter = chapterMap.get(chKey)!;
    if (!chapter.topics.has(row.topicTitle)) {
      chapter.topics.set(row.topicTitle, { title: row.topicTitle, questions: [] });
    }
    chapter.topics.get(row.topicTitle)!.questions.push(row);
  }

  const groupedByChapter = [...chapterMap.values()].map((ch) => ({
    chapterNumber: ch.chapterNumber,
    title: ch.title,
    topics: [...ch.topics.values()].map((t) => ({
      title: t.title,
      questionCount: t.questions.length,
      questions: t.questions.map((r) => ({
        ...r.question,
        sourcePaperTitle: r.question.sourcePaperId ? paperMap.get(r.question.sourcePaperId)?.title : null,
        sourcePaperUrl: r.question.sourcePaperId ? paperMap.get(r.question.sourcePaperId)?.sourceUrl : null,
      })),
    })),
    questionCount: [...ch.topics.values()].reduce((s, t) => s + t.questions.length, 0),
  }));

  return NextResponse.json({
    success: true,
    data: {
      board: { id: board.id, code: board.code, name: board.name },
      subjects: subjectRows,
      chapters: groupedByChapter,
      papers: paperRows,
      stats: statsRow ?? {},
    },
  });
}
