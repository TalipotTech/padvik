import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { sql, eq } from "drizzle-orm";
import { exams, examQuestions, examAttempts } from "@/db/schema/exams";
import { topics, chapters, subjects } from "@/db/schema/curriculum";
import { z } from "zod/v4";

/**
 * POST /api/learn/exam/start — Create a self-test exam for a topic
 */
const schema = z.object({
  topicId: z.number().int(),
  questionCount: z.number().int().min(1).max(30).optional(),
  difficulty: z.string().optional(),
});

export async function POST(request: NextRequest) {
  let userId: number | null = null;
  try { const s = await auth(); userId = s?.user?.id ? Number(s.user.id) : null; } catch {}
  if (!userId && process.env.NODE_ENV === "development") userId = 1;
  if (!userId) return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Login required" } }, { status: 401 });

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ success: false, error: { code: "INVALID_JSON", message: "Invalid JSON" } }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } }, { status: 400 });

  const { topicId, questionCount = 5, difficulty } = parsed.data;

  // Get topic context
  const [topic] = await db.select({ title: topics.title, chapterTitle: chapters.title, subjectName: subjects.name })
    .from(topics).innerJoin(chapters, eq(chapters.id, topics.chapterId)).innerJoin(subjects, eq(subjects.id, chapters.subjectId))
    .where(eq(topics.id, topicId)).limit(1);

  if (!topic) return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "Topic not found" } }, { status: 404 });

  // Fetch random questions for this topic
  const questions = await db.execute<{
    id: number; question_type: string; difficulty: string; question_text: string;
    options: unknown; marks: string; bloom_level: string | null;
  }>(sql`
    SELECT id, question_type, difficulty, question_text, options, marks, bloom_level
    FROM questions WHERE topic_id = ${topicId}
      AND options IS NOT NULL AND jsonb_array_length(options::jsonb) > 0
      AND question_type IN ('mcq', 'fill_blank', 'true_false')
      AND length(question_text) >= 40
      AND question_text NOT ILIKE '%above%passage%'
      AND question_text NOT ILIKE '%given%case%'
      AND question_text NOT ILIKE '%read the%'
    ${difficulty ? sql`AND difficulty = ${difficulty}` : sql``}
    ORDER BY random() LIMIT ${questionCount}
  `);

  const questionList = [...questions];
  if (questionList.length === 0) {
    return NextResponse.json({ success: false, error: { code: "NO_QUESTIONS", message: "No questions available for this topic" } }, { status: 404 });
  }

  const totalMarks = questionList.reduce((s, q) => s + parseFloat(q.marks), 0);

  // Create exam record
  const [exam] = await db.insert(exams).values({
    title: `Self-Test: ${topic.title}`,
    description: `Self-test on ${topic.subjectName} — ${topic.chapterTitle} — ${topic.title}`,
    examType: "self_test",
    generationMode: "auto",
    topicIds: [topicId],
    totalMarks: totalMarks.toFixed(1),
    durationMinutes: questionCount * 3,
    isPublished: true,
    maxAttempts: 99,
    createdBy: userId,
    metadata: { topicId, subjectName: topic.subjectName, chapterTitle: topic.chapterTitle, totalQuestions: questionList.length },
  }).returning();

  // Create exam questions
  for (let i = 0; i < questionList.length; i++) {
    await db.insert(examQuestions).values({
      examId: exam.id,
      questionId: questionList[i].id,
      sortOrder: i + 1,
    });
  }

  // Count previous attempts
  const prevAttempts = await db.execute<{ cnt: number }>(sql`
    SELECT count(*)::int as cnt FROM exam_attempts WHERE exam_id = ${exam.id} AND user_id = ${userId}
  `);
  const attemptNumber = ([...prevAttempts][0]?.cnt ?? 0) + 1;

  // Create attempt
  const [attempt] = await db.insert(examAttempts).values({
    examId: exam.id,
    userId,
    status: "started",
    attemptNumber,
    startedAt: new Date(),
    maxScore: totalMarks.toFixed(1),
  }).returning();

  return NextResponse.json({
    success: true,
    data: {
      examId: exam.id,
      attemptId: attempt.id,
      title: exam.title,
      totalMarks: Math.round(totalMarks),
      durationMinutes: exam.durationMinutes,
      questions: questionList.map((q) => ({
        id: q.id,
        questionType: q.question_type,
        difficulty: q.difficulty,
        questionText: q.question_text,
        options: q.options,
        marks: q.marks,
        bloomLevel: q.bloom_level,
        // NOTE: correctAnswer and solution NOT included — revealed after submission
      })),
    },
  }, { status: 201 });
}
