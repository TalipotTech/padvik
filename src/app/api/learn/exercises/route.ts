import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { sql } from "drizzle-orm";

/**
 * GET /api/learn/exercises?topicId=14&limit=5&difficulty=easy
 * Returns random questions for inline self-testing in the Playground.
 */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session && process.env.NODE_ENV !== "development") {
    return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Login required" } }, { status: 401 });
  }

  const topicId = request.nextUrl.searchParams.get("topicId");
  const limit = Math.min(parseInt(request.nextUrl.searchParams.get("limit") ?? "5", 10), 20);
  const difficulty = request.nextUrl.searchParams.get("difficulty");

  if (!topicId) {
    return NextResponse.json({ success: false, error: { code: "MISSING_PARAM", message: "topicId required" } }, { status: 400 });
  }

  const questions = await db.execute<{
    id: number;
    question_type: string;
    difficulty: string;
    bloom_level: string | null;
    question_text: string;
    options: unknown;
    correct_answer: string | null;
    solution: string | null;
    marks: string;
    source_type: string;
    source_year: number | null;
  }>(sql`
    SELECT id, question_type, difficulty, bloom_level, question_text, options,
      correct_answer, solution, marks, source_type, source_year
    FROM questions
    WHERE topic_id = ${parseInt(topicId, 10)}
      AND length(question_text) >= 40
      AND (options IS NULL OR jsonb_array_length(options::jsonb) > 0)
    ${difficulty ? sql`AND difficulty = ${difficulty}` : sql``}
    ORDER BY random()
    LIMIT ${limit}
  `);

  return NextResponse.json({ success: true, data: [...questions] });
}
