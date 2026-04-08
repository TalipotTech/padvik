import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { sql } from "drizzle-orm";

/**
 * GET /api/learn/exam/history?topicId=14
 * Returns exam history for the student.
 */
export async function GET(request: NextRequest) {
  let userId: number | null = null;
  try { const s = await auth(); userId = s?.user?.id ? Number(s.user.id) : null; } catch {}
  if (!userId && process.env.NODE_ENV === "development") userId = 1;
  if (!userId) return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Login required" } }, { status: 401 });

  const topicId = request.nextUrl.searchParams.get("topicId");

  const results = await db.execute<{
    attempt_id: number; exam_id: number; title: string; total_score: number | null;
    max_score: number | null; percentage: number | null; grade: string | null;
    status: string; attempt_number: number; started_at: string | null;
    submitted_at: string | null; topic_title: string; subject_name: string;
    chapter_title: string; topic_id: number; total_questions: number | null;
  }>(sql`
    SELECT
      ea.id AS attempt_id, e.id AS exam_id, e.title, ea.total_score, ea.max_score,
      ea.percentage, ea.grade, ea.status, ea.attempt_number,
      ea.started_at::text, ea.submitted_at::text,
      t.title AS topic_title, s.name AS subject_name, ch.title AS chapter_title,
      t.id AS topic_id, e.total_questions
    FROM exam_attempts ea
    JOIN exams e ON e.id = ea.exam_id
    JOIN topics t ON t.id = (e.topic_ids[1])
    JOIN chapters ch ON ch.id = t.chapter_id
    JOIN subjects s ON s.id = ch.subject_id
    WHERE ea.user_id = ${userId} AND e.exam_type = 'self_test'
    ${topicId ? sql`AND t.id = ${parseInt(topicId, 10)}` : sql``}
    ORDER BY ea.created_at DESC
    LIMIT 20
  `);

  return NextResponse.json({ success: true, data: [...results] });
}
