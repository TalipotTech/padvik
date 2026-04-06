import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { questions } from "@/db/schema/questions";
import { topics, chapters, subjects, standards, boards } from "@/db/schema/curriculum";
import { eq } from "drizzle-orm";
import { z } from "zod/v4";

// ---------------------------------------------------------------------------
// GET /api/questions/[id] — Get a single question with curriculum context
// ---------------------------------------------------------------------------
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Login required" } },
      { status: 401 }
    );
  }

  const { id } = await params;
  const questionId = Number(id);
  if (isNaN(questionId)) {
    return NextResponse.json(
      { success: false, error: { code: "INVALID_ID", message: "Invalid question ID" } },
      { status: 400 }
    );
  }

  const rows = await db
    .select({
      question: questions,
      topic: topics,
      chapter: chapters,
      subject: subjects,
      standard: standards,
      board: boards,
    })
    .from(questions)
    .innerJoin(topics, eq(questions.topicId, topics.id))
    .innerJoin(chapters, eq(topics.chapterId, chapters.id))
    .innerJoin(subjects, eq(chapters.subjectId, subjects.id))
    .innerJoin(standards, eq(subjects.standardId, standards.id))
    .innerJoin(boards, eq(standards.boardId, boards.id))
    .where(eq(questions.id, questionId))
    .limit(1);

  if (rows.length === 0) {
    return NextResponse.json(
      { success: false, error: { code: "NOT_FOUND", message: "Question not found" } },
      { status: 404 }
    );
  }

  const row = rows[0];
  return NextResponse.json({
    success: true,
    data: {
      ...row.question,
      topic: { id: row.topic.id, title: row.topic.title },
      chapter: { id: row.chapter.id, title: row.chapter.title, chapterNumber: row.chapter.chapterNumber },
      subject: { id: row.subject.id, name: row.subject.name, code: row.subject.code },
      standard: { id: row.standard.id, grade: row.standard.grade },
      board: { id: row.board.id, code: row.board.code, name: row.board.name },
    },
  });
}

// ---------------------------------------------------------------------------
// PUT /api/questions/[id] — Update a question
// ---------------------------------------------------------------------------
const updateQuestionSchema = z.object({
  questionType: z.enum(["mcq", "short_answer", "long_answer", "fill_blank", "true_false"]).optional(),
  difficulty: z.enum(["easy", "medium", "hard"]).optional(),
  bloomLevel: z.string().nullable().optional(),
  questionText: z.string().min(1).optional(),
  questionHtml: z.string().nullable().optional(),
  options: z
    .array(z.object({ label: z.string(), text: z.string(), isCorrect: z.boolean().optional() }))
    .nullable()
    .optional(),
  correctAnswer: z.string().nullable().optional(),
  solution: z.string().nullable().optional(),
  solutionHtml: z.string().nullable().optional(),
  marks: z.number().min(0).optional(),
  negativeMarks: z.number().min(0).optional(),
  timeSeconds: z.number().int().nullable().optional(),
  sectionLabel: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  topicId: z.number().int().optional(),
});

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Login required" } },
      { status: 401 }
    );
  }

  const { id } = await params;
  const questionId = Number(id);
  if (isNaN(questionId)) {
    return NextResponse.json(
      { success: false, error: { code: "INVALID_ID", message: "Invalid question ID" } },
      { status: 400 }
    );
  }

  // Check ownership or admin
  const [existing] = await db
    .select({ createdBy: questions.createdBy })
    .from(questions)
    .where(eq(questions.id, questionId))
    .limit(1);

  if (!existing) {
    return NextResponse.json(
      { success: false, error: { code: "NOT_FOUND", message: "Question not found" } },
      { status: 404 }
    );
  }

  const userId = Number(session.user.id);
  if (existing.createdBy !== userId && session.user.role !== "admin" && session.user.role !== "teacher") {
    return NextResponse.json(
      { success: false, error: { code: "FORBIDDEN", message: "You can only edit your own questions" } },
      { status: 403 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "INVALID_JSON", message: "Invalid JSON body" } },
      { status: 400 }
    );
  }

  const parsed = updateQuestionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } },
      { status: 400 }
    );
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  const data = parsed.data;
  if (data.questionType !== undefined) updates.questionType = data.questionType;
  if (data.difficulty !== undefined) updates.difficulty = data.difficulty;
  if (data.bloomLevel !== undefined) updates.bloomLevel = data.bloomLevel;
  if (data.questionText !== undefined) updates.questionText = data.questionText;
  if (data.questionHtml !== undefined) updates.questionHtml = data.questionHtml;
  if (data.options !== undefined) updates.options = data.options;
  if (data.correctAnswer !== undefined) updates.correctAnswer = data.correctAnswer;
  if (data.solution !== undefined) updates.solution = data.solution;
  if (data.solutionHtml !== undefined) updates.solutionHtml = data.solutionHtml;
  if (data.marks !== undefined) updates.marks = String(data.marks);
  if (data.negativeMarks !== undefined) updates.negativeMarks = String(data.negativeMarks);
  if (data.timeSeconds !== undefined) updates.timeSeconds = data.timeSeconds;
  if (data.sectionLabel !== undefined) updates.sectionLabel = data.sectionLabel;
  if (data.tags !== undefined) updates.tags = data.tags;
  if (data.topicId !== undefined) updates.topicId = data.topicId;

  const [updated] = await db
    .update(questions)
    .set(updates)
    .where(eq(questions.id, questionId))
    .returning();

  return NextResponse.json({ success: true, data: updated });
}

// ---------------------------------------------------------------------------
// DELETE /api/questions/[id] — Delete a question
// ---------------------------------------------------------------------------
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Login required" } },
      { status: 401 }
    );
  }

  const { id } = await params;
  const questionId = Number(id);
  if (isNaN(questionId)) {
    return NextResponse.json(
      { success: false, error: { code: "INVALID_ID", message: "Invalid question ID" } },
      { status: 400 }
    );
  }

  const [existing] = await db
    .select({ createdBy: questions.createdBy })
    .from(questions)
    .where(eq(questions.id, questionId))
    .limit(1);

  if (!existing) {
    return NextResponse.json(
      { success: false, error: { code: "NOT_FOUND", message: "Question not found" } },
      { status: 404 }
    );
  }

  const userId = Number(session.user.id);
  if (existing.createdBy !== userId && session.user.role !== "admin") {
    return NextResponse.json(
      { success: false, error: { code: "FORBIDDEN", message: "You can only delete your own questions" } },
      { status: 403 }
    );
  }

  await db.delete(questions).where(eq(questions.id, questionId));

  return NextResponse.json({ success: true, data: { deleted: true } });
}
