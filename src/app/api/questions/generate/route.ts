import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { questions } from "@/db/schema/questions";
import { topics, chapters, subjects, standards, boards } from "@/db/schema/curriculum";
import { eq, and } from "drizzle-orm";
import { z } from "zod/v4";
import { aiChat } from "@/lib/ai/provider";
import {
  SYSTEM_PROMPT,
  buildUserPrompt,
  parseResponse,
  config as promptConfig,
  type GenerateParams,
} from "@/lib/ai/prompts/question-generator";

// Extend timeout for AI generation
export const maxDuration = 120;

// ---------------------------------------------------------------------------
// POST /api/questions/generate — Generate questions from a topic using AI
// ---------------------------------------------------------------------------
const generateSchema = z.object({
  topicId: z.number().int(),
  questionType: z.enum(["mcq", "short_answer", "long_answer", "fill_blank", "true_false"]).default("mcq"),
  difficulty: z.enum(["easy", "medium", "hard"]).default("medium"),
  count: z.number().int().min(1).max(20).default(5),
  marks: z.number().min(0.5).max(10).default(1),
  language: z.string().default("en"),
  /** Use cheaper model for bulk generation */
  useBulkModel: z.boolean().default(false),
  /** Auto-save to DB (default true). If false, returns questions without saving. */
  autoSave: z.boolean().default(true),
});

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Login required" } },
      { status: 401 }
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

  const parsed = generateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } },
      { status: 400 }
    );
  }

  const { topicId, questionType, difficulty, count, marks, language, useBulkModel, autoSave } = parsed.data;
  const userId = Number(session.user.id) || null;

  // Fetch full topic context: topic → chapter → subject → standard → board
  const topicRows = await db
    .select({
      topic: topics,
      chapter: chapters,
      subject: subjects,
      standard: standards,
      board: boards,
    })
    .from(topics)
    .innerJoin(chapters, eq(topics.chapterId, chapters.id))
    .innerJoin(subjects, eq(chapters.subjectId, subjects.id))
    .innerJoin(standards, eq(subjects.standardId, standards.id))
    .innerJoin(boards, eq(standards.boardId, boards.id))
    .where(eq(topics.id, topicId))
    .limit(1);

  if (topicRows.length === 0) {
    return NextResponse.json(
      { success: false, error: { code: "NOT_FOUND", message: "Topic not found" } },
      { status: 404 }
    );
  }

  const row = topicRows[0];

  // Get existing questions for this topic to avoid duplicates
  const existingQs = await db
    .select({ text: questions.questionText })
    .from(questions)
    .where(and(eq(questions.topicId, topicId), eq(questions.questionType, questionType)))
    .limit(10);

  // Build AI prompt
  const generateParams: GenerateParams = {
    boardCode: row.board.code,
    grade: row.standard.grade,
    subjectName: row.subject.name,
    chapterTitle: row.chapter.title,
    chapterNumber: row.chapter.chapterNumber ?? undefined,
    topicTitle: row.topic.title,
    topicDescription: row.topic.description,
    learningObjectives: row.topic.learningObjectives as string[] | null,
    topicBloomLevel: row.topic.bloomLevel,
    questionType,
    difficulty,
    count,
    marks,
    language,
    existingQuestions: existingQs.map((q) => q.text),
  };

  const userPrompt = buildUserPrompt(generateParams);
  const model = useBulkModel ? promptConfig.bulkModel : promptConfig.model;
  const isGemini = model.startsWith("gemini-");

  try {
    const aiResult = await aiChat(userPrompt, {
      model,
      systemPrompt: SYSTEM_PROMPT,
      temperature: promptConfig.temperature,
      maxTokens: promptConfig.maxTokens,
      jsonOutput: isGemini,
    }, {
      pipelineStage: "question_generation",
      entityType: "topic",
      entityId: topicId,
    });

    const generated = parseResponse(aiResult.content);

    // Auto-save to DB if requested
    let savedQuestions: { id: number }[] = [];
    if (autoSave && generated.questions.length > 0) {
      const toInsert = generated.questions.map((q) => ({
        topicId,
        questionType: q.questionType || questionType,
        difficulty: q.difficulty || difficulty,
        bloomLevel: q.bloomLevel ?? null,
        questionText: q.questionText,
        questionHtml: null,
        questionImages: [] as unknown[],
        options: q.options ?? null,
        correctAnswer: q.correctAnswer,
        solution: q.solution,
        solutionHtml: null,
        marks: String(q.marks ?? marks),
        negativeMarks: "0.0",
        timeSeconds: null,
        sourceType: "ai_generated" as const,
        language,
        tags: q.tags ?? [],
        createdBy: userId,
        metadata: {
          generatedBy: aiResult.model,
          generatedAt: new Date().toISOString(),
          costUsd: aiResult.costUsd,
          inputTokens: aiResult.inputTokens,
          outputTokens: aiResult.outputTokens,
        },
      }));

      savedQuestions = await db
        .insert(questions)
        .values(toInsert)
        .returning({ id: questions.id });
    }

    return NextResponse.json({
      success: true,
      data: {
        questions: generated.questions.map((q, i) => ({
          ...q,
          id: savedQuestions[i]?.id ?? null,
          saved: autoSave,
        })),
        stats: {
          generated: generated.questions.length,
          saved: savedQuestions.length,
          model: aiResult.model,
          inputTokens: aiResult.inputTokens,
          outputTokens: aiResult.outputTokens,
          costUsd: aiResult.costUsd,
          durationMs: aiResult.durationMs,
        },
        context: {
          board: row.board.code,
          grade: row.standard.grade,
          subject: row.subject.name,
          chapter: row.chapter.title,
          topic: row.topic.title,
        },
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: { code: "GENERATION_FAILED", message } },
      { status: 500 }
    );
  }
}
