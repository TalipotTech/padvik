import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { questions } from "@/db/schema/questions";
import { z } from "zod/v4";

// ---------------------------------------------------------------------------
// POST /api/questions/bulk — Bulk create questions (from CSV/Excel import)
// ---------------------------------------------------------------------------
const bulkQuestionSchema = z.object({
  topicId: z.number().int(),
  questionType: z.enum(["mcq", "short_answer", "long_answer", "fill_blank", "true_false"]),
  difficulty: z.enum(["easy", "medium", "hard"]),
  questionText: z.string().min(1),
  options: z
    .array(z.object({ label: z.string(), text: z.string(), isCorrect: z.boolean().optional() }))
    .optional(),
  correctAnswer: z.string().optional(),
  solution: z.string().optional(),
  marks: z.number().min(0).default(1),
  bloomLevel: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

const bulkCreateSchema = z.object({
  questions: z.array(bulkQuestionSchema).min(1).max(500),
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

  const parsed = bulkCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } },
      { status: 400 }
    );
  }

  const userId = Number(session.user.id);
  const toInsert = parsed.data.questions.map((q) => ({
    topicId: q.topicId,
    questionType: q.questionType,
    difficulty: q.difficulty,
    bloomLevel: q.bloomLevel ?? null,
    questionText: q.questionText,
    questionHtml: null,
    questionImages: [] as unknown[],
    options: q.options ?? null,
    correctAnswer: q.correctAnswer ?? null,
    solution: q.solution ?? null,
    solutionHtml: null,
    marks: String(q.marks),
    negativeMarks: "0.0",
    sourceType: "user_uploaded" as const,
    language: "en",
    tags: q.tags ?? [],
    createdBy: userId,
    metadata: { createdVia: "bulk_import" },
  }));

  const inserted = await db.insert(questions).values(toInsert).returning({ id: questions.id });

  return NextResponse.json(
    {
      success: true,
      data: {
        inserted: inserted.length,
        ids: inserted.map((r) => r.id),
      },
    },
    { status: 201 }
  );
}
