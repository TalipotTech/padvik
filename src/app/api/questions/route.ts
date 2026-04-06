import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { questions } from "@/db/schema/questions";
import { topics, chapters } from "@/db/schema/curriculum";
import { eq, and, desc, ilike, sql, inArray } from "drizzle-orm";
import { z } from "zod/v4";

// ---------------------------------------------------------------------------
// GET /api/questions — List/search questions with filters
// ---------------------------------------------------------------------------
const querySchema = z.object({
  topicId: z.coerce.number().optional(),
  chapterId: z.coerce.number().optional(),
  subjectId: z.coerce.number().optional(),
  questionType: z.string().optional(),
  difficulty: z.enum(["easy", "medium", "hard"]).optional(),
  sourceType: z.string().optional(),
  createdBy: z.coerce.number().optional(),
  search: z.string().optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
});

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Login required" } },
      { status: 401 }
    );
  }

  const params = Object.fromEntries(request.nextUrl.searchParams);
  const parsed = querySchema.safeParse(params);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } },
      { status: 400 }
    );
  }

  const { topicId, chapterId, subjectId, questionType, difficulty, sourceType, createdBy, search, page, limit } = parsed.data;
  const offset = (page - 1) * limit;

  // Build conditions
  const conditions = [];

  if (topicId) {
    conditions.push(eq(questions.topicId, topicId));
  } else if (chapterId) {
    // Get all topic IDs for this chapter
    const chapterTopics = await db
      .select({ id: topics.id })
      .from(topics)
      .where(eq(topics.chapterId, chapterId));
    if (chapterTopics.length > 0) {
      conditions.push(inArray(questions.topicId, chapterTopics.map((t) => t.id)));
    }
  } else if (subjectId) {
    // Get all topic IDs for this subject
    const subjectTopics = await db
      .select({ id: topics.id })
      .from(topics)
      .innerJoin(chapters, eq(topics.chapterId, chapters.id))
      .where(eq(chapters.subjectId, subjectId));
    if (subjectTopics.length > 0) {
      conditions.push(inArray(questions.topicId, subjectTopics.map((t) => t.id)));
    }
  }

  if (questionType) conditions.push(eq(questions.questionType, questionType));
  if (difficulty) conditions.push(eq(questions.difficulty, difficulty));
  if (sourceType) conditions.push(eq(questions.sourceType, sourceType));
  if (createdBy) conditions.push(eq(questions.createdBy, createdBy));
  if (search) conditions.push(ilike(questions.questionText, `%${search}%`));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, countResult] = await Promise.all([
    db
      .select()
      .from(questions)
      .where(whereClause)
      .orderBy(desc(questions.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(questions)
      .where(whereClause),
  ]);

  return NextResponse.json({
    success: true,
    data: {
      questions: rows,
      pagination: {
        page,
        limit,
        total: countResult[0]?.count ?? 0,
        totalPages: Math.ceil((countResult[0]?.count ?? 0) / limit),
      },
    },
  });
}

// ---------------------------------------------------------------------------
// POST /api/questions — Create a single question (manual entry)
// ---------------------------------------------------------------------------
const createQuestionSchema = z.object({
  topicId: z.number().int(),
  questionType: z.enum(["mcq", "short_answer", "long_answer", "fill_blank", "true_false"]),
  difficulty: z.enum(["easy", "medium", "hard"]),
  bloomLevel: z.string().optional(),
  questionText: z.string().min(1),
  questionHtml: z.string().optional(),
  questionImages: z.array(z.unknown()).optional(),
  options: z
    .array(
      z.object({
        label: z.string(),
        text: z.string(),
        isCorrect: z.boolean().optional(),
      })
    )
    .optional(),
  correctAnswer: z.string().optional(),
  solution: z.string().optional(),
  solutionHtml: z.string().optional(),
  marks: z.number().min(0).default(1),
  negativeMarks: z.number().min(0).default(0),
  timeSeconds: z.number().int().optional(),
  sectionLabel: z.string().optional(),
  language: z.string().default("en"),
  tags: z.array(z.string()).optional(),
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

  const parsed = createQuestionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } },
      { status: 400 }
    );
  }

  const data = parsed.data;
  const userId = Number(session.user.id);

  const [question] = await db
    .insert(questions)
    .values({
      topicId: data.topicId,
      questionType: data.questionType,
      difficulty: data.difficulty,
      bloomLevel: data.bloomLevel ?? null,
      questionText: data.questionText,
      questionHtml: data.questionHtml ?? null,
      questionImages: data.questionImages ?? [],
      options: data.options ?? null,
      correctAnswer: data.correctAnswer ?? null,
      solution: data.solution ?? null,
      solutionHtml: data.solutionHtml ?? null,
      marks: String(data.marks),
      negativeMarks: String(data.negativeMarks),
      timeSeconds: data.timeSeconds ?? null,
      sectionLabel: data.sectionLabel ?? null,
      sourceType: "user_uploaded",
      language: data.language,
      tags: data.tags ?? [],
      createdBy: userId,
      metadata: { createdVia: "manual_entry" },
    })
    .returning();

  return NextResponse.json({ success: true, data: question }, { status: 201 });
}
