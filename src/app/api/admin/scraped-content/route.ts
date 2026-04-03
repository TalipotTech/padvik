import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { sql } from "drizzle-orm";

/**
 * GET /api/admin/scraped-content — Summary of all content in the database
 * Shows boards, grades, subjects, chapters, topics counts.
 */
export async function GET() {
  const session = await auth();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Admin access required" } },
      { status: 403 }
    );
  }

  try {
    // Overall totals
    const [totals] = await db.execute(sql`
      SELECT
        (SELECT count(*) FROM boards WHERE is_active = true)::int AS total_boards,
        (SELECT count(*) FROM standards)::int AS total_standards,
        (SELECT count(*) FROM subjects)::int AS total_subjects,
        (SELECT count(*) FROM chapters)::int AS total_chapters,
        (SELECT count(*) FROM topics)::int AS total_topics
    `);

    // Per-board breakdown with grade ranges
    const byBoard = await db.execute(sql`
      SELECT
        b.code AS board_code,
        b.name AS board_name,
        count(DISTINCT st.id)::int AS standards_count,
        count(DISTINCT sub.id)::int AS subjects_count,
        count(DISTINCT ch.id)::int AS chapters_count,
        count(DISTINCT t.id)::int AS topics_count,
        array_agg(DISTINCT st.grade ORDER BY st.grade) AS grades
      FROM boards b
      LEFT JOIN standards st ON st.board_id = b.id
      LEFT JOIN subjects sub ON sub.standard_id = st.id
      LEFT JOIN chapters ch ON ch.subject_id = sub.id
      LEFT JOIN topics t ON t.chapter_id = ch.id
      WHERE b.is_active = true
      GROUP BY b.id, b.code, b.name
      ORDER BY b.id
    `);

    // Per-grade detail for boards that have content (chapters > 0)
    const byGrade = await db.execute(sql`
      SELECT
        b.code AS board_code,
        st.grade,
        st.stream,
        count(DISTINCT sub.id)::int AS subjects_count,
        count(DISTINCT ch.id)::int AS chapters_count,
        count(DISTINCT t.id)::int AS topics_count,
        array_agg(DISTINCT sub.name ORDER BY sub.name) AS subject_names
      FROM boards b
      JOIN standards st ON st.board_id = b.id
      JOIN subjects sub ON sub.standard_id = st.id
      LEFT JOIN chapters ch ON ch.subject_id = sub.id
      LEFT JOIN topics t ON t.chapter_id = ch.id
      WHERE b.is_active = true
      GROUP BY b.code, st.grade, st.stream
      HAVING count(DISTINCT ch.id) > 0
      ORDER BY b.code, st.grade, st.stream
    `);

    // Recent chapters added (last 20)
    const recentChapters = await db.execute(sql`
      SELECT
        ch.id,
        ch.title,
        ch.chapter_number,
        sub.name AS subject_name,
        st.grade,
        b.code AS board_code,
        ch.created_at,
        (SELECT count(*) FROM topics WHERE chapter_id = ch.id)::int AS topic_count
      FROM chapters ch
      JOIN subjects sub ON ch.subject_id = sub.id
      JOIN standards st ON sub.standard_id = st.id
      JOIN boards b ON st.board_id = b.id
      ORDER BY ch.created_at DESC
      LIMIT 20
    `);

    return NextResponse.json({
      success: true,
      data: {
        totals,
        byBoard,
        byGrade,
        recentChapters,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: { code: "QUERY_ERROR", message } },
      { status: 500 }
    );
  }
}
