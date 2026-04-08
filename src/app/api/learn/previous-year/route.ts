import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { sql } from "drizzle-orm";

/**
 * GET /api/learn/previous-year?topicId=14&limit=10
 * Returns previous year / scraped questions with answers for a topic.
 */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session && process.env.NODE_ENV !== "development") {
    return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Login required" } }, { status: 401 });
  }

  const topicId = request.nextUrl.searchParams.get("topicId");
  const limit = Math.min(parseInt(request.nextUrl.searchParams.get("limit") ?? "20", 10), 50);

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
    source_ref: string | null;
    source_year: number | null;
  }>(sql`
    SELECT id, question_type, difficulty, bloom_level, question_text, options,
      correct_answer, solution, marks, source_type, source_ref, source_year
    FROM questions
    WHERE topic_id = ${parseInt(topicId, 10)}
      AND source_type = 'scraped'
    ORDER BY source_year DESC NULLS LAST, id DESC
    LIMIT ${limit}
  `);

  return NextResponse.json({ success: true, data: [...questions] });
}
