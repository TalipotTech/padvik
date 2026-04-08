import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { eq, and, sql, inArray } from "drizzle-orm";
import { examAttempts, examResponses, examQuestions } from "@/db/schema/exams";
import { questions } from "@/db/schema/questions";
import { z } from "zod/v4";

/**
 * POST /api/learn/exam/[attemptId]/submit — Submit exam answers and auto-evaluate
 */
const schema = z.object({
  responses: z.array(z.object({
    questionId: z.union([z.number(), z.string()]).transform((v) => typeof v === "string" ? parseInt(v, 10) : v),
    selectedOptionIds: z.array(z.string()).optional(),
    responseText: z.string().optional(),
  })),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ attemptId: string }> }
) {
  let userId: number | null = null;
  try { const s = await auth(); userId = s?.user?.id ? Number(s.user.id) : null; } catch {}
  if (!userId && process.env.NODE_ENV === "development") userId = 1;
  if (!userId) return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Login required" } }, { status: 401 });

  const { attemptId: aidStr } = await params;
  const attemptId = parseInt(aidStr, 10);

  try {
  // Verify attempt ownership
  const [attempt] = await db.select().from(examAttempts)
    .where(and(eq(examAttempts.id, attemptId), eq(examAttempts.userId, userId))).limit(1);
  if (!attempt) return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "Attempt not found" } }, { status: 404 });
  if (attempt.status !== "started") return NextResponse.json({ success: false, error: { code: "ALREADY_SUBMITTED", message: "Exam already submitted" } }, { status: 400 });

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ success: false, error: { code: "INVALID_JSON", message: "Invalid JSON" } }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } }, { status: 400 });

  // Get the questions with correct answers for evaluation
  const examQs = await db.select({ questionId: examQuestions.questionId }).from(examQuestions).where(eq(examQuestions.examId, attempt.examId));
  const qIds = examQs.map((q) => q.questionId);

  const questionData = qIds.length > 0
    ? await db.select().from(questions).where(inArray(questions.id, qIds))
    : [];
  const questionMap = new Map(questionData.map((q) => [q.id, q]));

  let totalScore = 0;
  let maxScore = 0;
  const responseResults: Array<{
    questionId: number; isCorrect: boolean | null; marksObtained: number;
    correctAnswer: string | null; solution: string | null; userAnswer: string;
  }> = [];

  for (const resp of parsed.data.responses) {
    const question = questionMap.get(resp.questionId);
    if (!question) continue;

    const marks = parseFloat(question.marks ?? "1");
    maxScore += marks;

    let isCorrect: boolean | null = null;
    let marksObtained = 0;
    let userAnswer = "";

    if (question.questionType === "mcq" && resp.selectedOptionIds?.length) {
      // Auto-evaluate MCQ
      const correctAnswer = question.correctAnswer ?? "";
      const selectedLabels = resp.selectedOptionIds.map(String);
      userAnswer = selectedLabels.join(", ");

      // Check if selected option matches correct answer
      const opts = (question.options ?? []) as Array<{ label: string; text: string; isCorrect: boolean }>;
      const correctOpts = opts.filter((o) => o.isCorrect).map((o) => o.label);
      isCorrect = selectedLabels.length === correctOpts.length && selectedLabels.every((s) => correctOpts.includes(s));
      marksObtained = isCorrect ? marks : 0;
    } else if (resp.responseText) {
      userAnswer = resp.responseText;
      // Descriptive — not auto-evaluated
      isCorrect = null;
      marksObtained = 0;
    }

    if (isCorrect) totalScore += marksObtained;

    // Save response
    await db.insert(examResponses).values({
      attemptId,
      questionId: resp.questionId,
      responseText: resp.responseText ?? null,
      selectedOptionIds: resp.selectedOptionIds ?? [],
      isCorrect,
      marksObtained: marksObtained.toString(),
    });

    responseResults.push({
      questionId: resp.questionId,
      isCorrect,
      marksObtained,
      correctAnswer: question.correctAnswer,
      solution: question.solution,
      userAnswer,
    });
  }

  // Calculate percentage and grade
  const percentage = maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0;
  const grade = percentage >= 90 ? "A" : percentage >= 75 ? "B" : percentage >= 60 ? "C" : percentage >= 35 ? "D" : "F";

  // Update attempt
  await db.update(examAttempts).set({
    status: "submitted",
    submittedAt: new Date(),
    totalScore: totalScore.toFixed(1),
    maxScore: maxScore.toFixed(1),
    percentage: percentage.toFixed(2),
    grade,
    evaluationMode: "auto",
  }).where(eq(examAttempts.id, attemptId));

  return NextResponse.json({
    success: true,
    data: {
      attemptId,
      totalScore: Math.round(totalScore),
      maxScore: Math.round(maxScore),
      percentage,
      grade,
      responses: responseResults,
    },
  });
  } catch (err) {
    console.error("[ExamSubmit] Error:", err);
    return NextResponse.json({
      success: false,
      error: { code: "SUBMIT_ERROR", message: err instanceof Error ? err.message : String(err) },
    }, { status: 500 });
  }
}
