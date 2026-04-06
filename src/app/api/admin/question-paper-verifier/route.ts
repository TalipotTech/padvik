import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { questions, questionPapers } from "@/db/schema/questions";
import { boards, standards } from "@/db/schema/curriculum";
import { eq, and, desc } from "drizzle-orm";

// ---------------------------------------------------------------------------
// GET /api/admin/question-paper-verifier
// ?boardCode=CBSE&grade=10           → list papers
// ?boardCode=CBSE&grade=10&paperId=X → paper detail + questions
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
  const paperId = params.get("paperId");

  // Get board
  const [board] = await db
    .select()
    .from(boards)
    .where(eq(boards.code, boardCode))
    .limit(1);

  if (!board) {
    return NextResponse.json({
      success: true,
      data: { board: null, papers: [], paper: null, questions: [] },
    });
  }

  // Build paper conditions
  const paperConditions = [eq(questionPapers.boardId, board.id)];
  if (gradeFilter) {
    const [std] = await db
      .select({ id: standards.id })
      .from(standards)
      .where(and(eq(standards.boardId, board.id), eq(standards.grade, parseInt(gradeFilter))))
      .limit(1);
    if (std) paperConditions.push(eq(questionPapers.standardId, std.id));
  }

  // Get list of papers
  const paperRows = await db
    .select()
    .from(questionPapers)
    .where(and(...paperConditions))
    .orderBy(desc(questionPapers.createdAt));

  // If a specific paper is selected, get its questions
  let paperDetail = null;
  let questionRows: (typeof questions.$inferSelect)[] = [];

  if (paperId) {
    const pid = parseInt(paperId);

    const [paper] = await db
      .select()
      .from(questionPapers)
      .where(eq(questionPapers.id, pid))
      .limit(1);

    if (paper) {
      const meta = (paper.metadata ?? {}) as Record<string, unknown>;
      paperDetail = {
        ...paper,
        aiModel: meta.aiModel ?? meta.parsedBy ?? paper.parsedBy,
        sourcePdf: meta.sourcePdf,
      };

      // Get all questions for this paper, ordered by section + question number
      questionRows = await db
        .select()
        .from(questions)
        .where(eq(questions.sourcePaperId, pid))
        .orderBy(questions.sectionLabel, questions.questionNumber);
    }
  }

  // Group questions by section for the selected paper
  const sections: {
    label: string;
    title: string;
    questions: (typeof questions.$inferSelect)[];
  }[] = [];

  if (questionRows.length > 0) {
    const sectionMap = new Map<string, (typeof questions.$inferSelect)[]>();
    for (const q of questionRows) {
      const label = q.sectionLabel ?? "Unsorted";
      if (!sectionMap.has(label)) sectionMap.set(label, []);
      sectionMap.get(label)!.push(q);
    }

    const SECTION_TITLES: Record<string, string> = {
      A: "Section A — MCQs (1 mark)",
      B: "Section B — Short Answer (2 marks)",
      C: "Section C — Short Answer (3 marks)",
      D: "Section D — Long Answer (5 marks)",
      E: "Section E — Case-Based (4 marks)",
      Unsorted: "Unsorted Questions",
    };

    // Sort section labels naturally (Case Study 1, 2, ..., 10, 11)
    const sortedLabels = [...sectionMap.keys()].sort((a, b) => {
      const numA = parseInt(a.replace(/\D/g, "")) || 0;
      const numB = parseInt(b.replace(/\D/g, "")) || 0;
      if (numA && numB) return numA - numB;
      return a.localeCompare(b);
    });

    for (const label of sortedLabels) {
      const qs = sectionMap.get(label)!;
      sections.push({
        label,
        title: SECTION_TITLES[label] ?? label,
        questions: qs,
      });
    }
  }

  return NextResponse.json({
    success: true,
    data: {
      board: { id: board.id, code: board.code, name: board.name },
      papers: paperRows.map((p) => ({
        id: p.id,
        title: p.paperTitle,
        year: p.paperYear,
        type: p.paperType,
        sourceUrl: p.sourceUrl,
        questionCount: p.questionCount,
        status: p.parsingStatus,
        totalMarks: p.totalMarks,
      })),
      paper: paperDetail,
      sections,
      totalQuestions: questionRows.length,
    },
  });
}
