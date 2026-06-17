/**
 * GET /api/admin/explainer/stats
 *
 * Coverage + quality stats for the explainer decks, plus the topics
 * where students are getting most stuck (= highest re-explanation rate).
 */
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";

export async function GET() {
  const session = await auth();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json(
      { success: false, error: { code: "FORBIDDEN", message: "Admin required" } },
      { status: 403 }
    );
  }

  const coverage = await db.execute<{
    board_id: number | null;
    board_name: string | null;
    subject_id: number | null;
    subject_name: string | null;
    level: number;
    topic_total: number;
    decks_built: number;
  }>(sql`
    SELECT
      b.id AS board_id,
      b.name AS board_name,
      s.id AS subject_id,
      s.name AS subject_name,
      lvl.level,
      (
        SELECT count(*)::int FROM topics t2
        JOIN chapters c2 ON c2.id = t2.chapter_id
        WHERE c2.subject_id = s.id
      ) AS topic_total,
      (
        SELECT count(*)::int FROM topic_explainer_decks d
        JOIN topics t3 ON t3.id = d.topic_id
        JOIN chapters c3 ON c3.id = t3.chapter_id
        WHERE c3.subject_id = s.id AND d.level = lvl.level
      ) AS decks_built
    FROM (VALUES (1), (2), (3)) AS lvl(level)
    CROSS JOIN subjects s
    JOIN standards st ON st.id = s.standard_id
    JOIN boards b ON b.id = st.board_id
    ORDER BY b.name, s.name, lvl.level
    LIMIT 200
  `);

  const avgCompletion = await db.execute<{
    total_decks: number;
    avg_completion: string | null;
    total_views: number;
  }>(sql`
    SELECT
      count(*)::int AS total_decks,
      avg(avg_completion)::text AS avg_completion,
      COALESCE(sum(view_count), 0)::int AS total_views
    FROM topic_explainer_decks
  `);

  const stuckTopics = await db.execute<{
    topic_id: number;
    topic_title: string;
    subject_name: string;
    avg_re_explanations: string;
    students: number;
  }>(sql`
    SELECT
      t.id AS topic_id,
      t.title AS topic_title,
      s.name AS subject_name,
      avg(p.re_explanations)::numeric(5,2)::text AS avg_re_explanations,
      count(*)::int AS students
    FROM student_explainer_progress p
    JOIN topics t ON t.id = p.topic_id
    JOIN chapters c ON c.id = t.chapter_id
    JOIN subjects s ON s.id = c.subject_id
    WHERE p.re_explanations > 0
    GROUP BY t.id, t.title, s.name
    HAVING count(*) >= 2
    ORDER BY avg(p.re_explanations) DESC
    LIMIT 20
  `);

  return NextResponse.json({
    success: true,
    data: {
      coverage: [...coverage],
      overall: avgCompletion[0] ?? {
        total_decks: 0,
        avg_completion: null,
        total_views: 0,
      },
      stuckTopics: [...stuckTopics],
    },
  });
}
