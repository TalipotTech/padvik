import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { questions, questionPapers } from "@/db/schema/questions";
import { topics, chapters, subjects, standards, boards } from "@/db/schema/curriculum";
import { eq } from "drizzle-orm";
import { z } from "zod/v4";
import { aiChat, AI_MODELS } from "@/lib/ai/provider";
import {
  SYSTEM_PROMPT,
  buildUserPrompt,
  parseResponse,
  config as promptConfig,
} from "@/lib/ai/prompts/question-generator";

export const maxDuration = 300; // 5 min for full paper generation

// ---------------------------------------------------------------------------
// CBSE default paper pattern
// ---------------------------------------------------------------------------
const CBSE_PAPER_PATTERN = [
  { section: "A", type: "mcq", marks: 1, count: 20, difficulty: "easy", bloom: "Remember" },
  { section: "B", type: "short_answer", marks: 2, count: 5, difficulty: "medium", bloom: "Understand" },
  { section: "C", type: "short_answer", marks: 3, count: 6, difficulty: "medium", bloom: "Apply" },
  { section: "D", type: "long_answer", marks: 5, count: 4, difficulty: "hard", bloom: "Analyze" },
  { section: "E", type: "long_answer", marks: 4, count: 3, difficulty: "hard", bloom: "Evaluate" },
];

// ---------------------------------------------------------------------------
// POST /api/questions/generate-paper — Generate a complete mock exam paper
// ---------------------------------------------------------------------------
const generatePaperSchema = z.object({
  subjectId: z.number().int(),
  title: z.string().optional(),
  language: z.string().default("en"),
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
      { success: false, error: { code: "INVALID_JSON", message: "Invalid JSON" } },
      { status: 400 }
    );
  }

  const parsed = generatePaperSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } },
      { status: 400 }
    );
  }

  const { subjectId, title, language } = parsed.data;
  const userId = Number(session.user.id) || null;

  // Fetch subject with board context
  const [subjectRow] = await db
    .select({
      subject: subjects,
      standard: standards,
      board: boards,
    })
    .from(subjects)
    .innerJoin(standards, eq(subjects.standardId, standards.id))
    .innerJoin(boards, eq(standards.boardId, boards.id))
    .where(eq(subjects.id, subjectId))
    .limit(1);

  if (!subjectRow) {
    return NextResponse.json(
      { success: false, error: { code: "NOT_FOUND", message: "Subject not found" } },
      { status: 404 }
    );
  }

  // Fetch all chapters and topics for the subject
  const _chapterRows = await db
    .select({ chapter: chapters })
    .from(chapters)
    .where(eq(chapters.subjectId, subjectId))
    .orderBy(chapters.chapterNumber);

  const topicRows = await db
    .select({ topic: topics, chapterTitle: chapters.title, chapterNumber: chapters.chapterNumber })
    .from(topics)
    .innerJoin(chapters, eq(topics.chapterId, chapters.id))
    .where(eq(chapters.subjectId, subjectId))
    .orderBy(chapters.chapterNumber, topics.sortOrder);

  if (topicRows.length === 0) {
    return NextResponse.json(
      { success: false, error: { code: "NO_TOPICS", message: "No topics found for this subject. Scrape the syllabus first." } },
      { status: 400 }
    );
  }

  // Create question paper record
  const paperTitle = title ?? `${subjectRow.subject.name} AI Mock Paper - Class ${subjectRow.standard.grade} (${new Date().getFullYear()})`;
  const totalMarks = CBSE_PAPER_PATTERN.reduce((s, sec) => s + sec.marks * sec.count, 0);

  const [paper] = await db
    .insert(questionPapers)
    .values({
      boardId: subjectRow.board.id,
      standardId: subjectRow.standard.id,
      subjectId,
      paperTitle,
      paperYear: new Date().getFullYear(),
      paperType: "ai_mock",
      totalMarks,
      durationMinutes: 180,
      parsingStatus: "processing",
      parsedBy: "ai_generator",
      metadata: {
        generatedBy: session.user.email,
        generatedAt: new Date().toISOString(),
        pattern: CBSE_PAPER_PATTERN,
      },
    })
    .returning();

  // Generate questions section by section
  const allGeneratedQuestions: { id: number; section: string }[] = [];
  let totalCost = 0;
  let totalTokens = 0;
  const errors: string[] = [];

  for (const section of CBSE_PAPER_PATTERN) {
    // Distribute questions across topics (round-robin)
    const questionsPerTopic = Math.ceil(section.count / topicRows.length);

    // Select topics for this section (spread across chapters)
    const selectedTopics = topicRows.slice(0, Math.min(section.count, topicRows.length));

    let sectionGenerated = 0;

    for (const topicRow of selectedTopics) {
      if (sectionGenerated >= section.count) break;

      const remaining = section.count - sectionGenerated;
      const toGenerate = Math.min(questionsPerTopic, remaining);

      try {
        const userPrompt = buildUserPrompt({
          boardCode: subjectRow.board.code,
          grade: subjectRow.standard.grade,
          subjectName: subjectRow.subject.name,
          chapterTitle: topicRow.chapterTitle,
          chapterNumber: topicRow.chapterNumber ?? undefined,
          topicTitle: topicRow.topic.title,
          topicDescription: topicRow.topic.description,
          learningObjectives: topicRow.topic.learningObjectives as string[] | null,
          topicBloomLevel: section.bloom,
          questionType: section.type,
          difficulty: section.difficulty,
          count: toGenerate,
          marks: section.marks,
          language,
        });

        const model = section.type === "mcq" ? AI_MODELS.GEMINI_FLASH : AI_MODELS.PRIMARY;
        const isGemini = model.startsWith("gemini-");

        const aiResult = await aiChat(userPrompt, {
          model,
          systemPrompt: SYSTEM_PROMPT,
          temperature: promptConfig.temperature,
          maxTokens: promptConfig.maxTokens,
          jsonOutput: isGemini,
        });

        totalCost += aiResult.costUsd;
        totalTokens += aiResult.inputTokens + aiResult.outputTokens;

        const generated = parseResponse(aiResult.content);

        // Insert questions
        for (const q of generated.questions.slice(0, toGenerate)) {
          const [inserted] = await db
            .insert(questions)
            .values({
              topicId: topicRow.topic.id,
              questionType: q.questionType || section.type,
              difficulty: q.difficulty || section.difficulty,
              bloomLevel: q.bloomLevel ?? section.bloom,
              questionText: q.questionText,
              options: q.options || null,
              correctAnswer: q.correctAnswer ?? "",
              solution: q.solution ?? "",
              marks: String(q.marks ?? section.marks),
              negativeMarks: "0.0",
              sourceType: "ai_generated",
              sourcePaperId: paper.id,
              sectionLabel: section.section,
              language,
              tags: Array.isArray(q.tags) ? q.tags.map(String) : [],
              createdBy: userId,
              metadata: {
                generatedBy: aiResult.model,
                paperId: paper.id,
                section: section.section,
              },
            })
            .returning({ id: questions.id });

          allGeneratedQuestions.push({ id: inserted.id, section: section.section });
          sectionGenerated++;
        }
      } catch (err) {
        const msg = `Section ${section.section}, topic "${topicRow.topic.title}": ${err instanceof Error ? err.message : String(err)}`;
        errors.push(msg);
        console.error(`[GeneratePaper] ${msg}`);
      }
    }
  }

  // Update paper record
  await db
    .update(questionPapers)
    .set({
      parsingStatus: "completed",
      questionCount: allGeneratedQuestions.length,
      metadata: {
        ...(paper.metadata as Record<string, unknown>),
        totalCostUsd: totalCost,
        totalTokens,
        errors: errors.length > 0 ? errors : undefined,
      },
    })
    .where(eq(questionPapers.id, paper.id));

  return NextResponse.json({
    success: true,
    data: {
      paperId: paper.id,
      paperTitle,
      totalMarks,
      questionsGenerated: allGeneratedQuestions.length,
      sections: CBSE_PAPER_PATTERN.map((sec) => ({
        section: sec.section,
        type: sec.type,
        marks: sec.marks,
        target: sec.count,
        generated: allGeneratedQuestions.filter((q) => q.section === sec.section).length,
      })),
      stats: {
        totalCostUsd: totalCost,
        totalTokens,
        errors: errors.length,
      },
    },
  }, { status: 201 });
}
