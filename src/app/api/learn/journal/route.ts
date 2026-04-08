import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { sql } from "drizzle-orm";

/**
 * GET /api/learn/journal?tab=notes|chats|exams&search=&subjectId=&limit=50&offset=0
 * Returns detailed history data for the Study Journal page.
 */
export async function GET(request: NextRequest) {
  let userId: number | null = null;
  try { const s = await auth(); userId = s?.user?.id ? Number(s.user.id) : null; } catch {}
  if (!userId && process.env.NODE_ENV === "development") userId = 1;
  if (!userId) return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Login required" } }, { status: 401 });

  const url = new URL(request.url);
  const tab = url.searchParams.get("tab") ?? "notes";
  const search = url.searchParams.get("search") ?? "";
  const subjectId = url.searchParams.get("subjectId");
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10), 100);
  const offset = parseInt(url.searchParams.get("offset") ?? "0", 10);

  const searchFilter = search ? sql`AND (t.title ILIKE ${"%" + search + "%"} OR s.name ILIKE ${"%" + search + "%"})` : sql``;
  const subjectFilter = subjectId ? sql`AND s.id = ${parseInt(subjectId, 10)}` : sql``;

  if (tab === "notes") {
    const notes = await db.execute<{
      id: number; topic_id: number; title: string | null; body: string; note_type: string;
      image_url: string | null; created_at: string; topic_title: string; chapter_title: string;
      chapter_number: number; subject_name: string; subject_id: number; grade: number; board_code: string;
    }>(sql`
      SELECT un.id, un.topic_id, un.title, un.body, COALESCE(un.note_type, 'typed') as note_type,
        un.image_url, un.created_at::text,
        t.title AS topic_title, ch.title AS chapter_title, ch.chapter_number,
        s.name AS subject_name, s.id AS subject_id, st.grade, b.code AS board_code
      FROM user_notes un
      JOIN topics t ON t.id = un.topic_id
      JOIN chapters ch ON ch.id = t.chapter_id
      JOIN subjects s ON s.id = ch.subject_id
      JOIN standards st ON st.id = s.standard_id
      JOIN boards b ON b.id = st.board_id
      WHERE un.user_id = ${userId} ${searchFilter} ${subjectFilter}
      ORDER BY un.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `);

    const [countResult] = await db.execute<{ cnt: number }>(sql`
      SELECT count(*)::int as cnt FROM user_notes un
      JOIN topics t ON t.id = un.topic_id JOIN chapters ch ON ch.id = t.chapter_id
      JOIN subjects s ON s.id = ch.subject_id
      WHERE un.user_id = ${userId} ${searchFilter} ${subjectFilter}
    `);

    return NextResponse.json({ success: true, data: { items: [...notes], total: countResult?.cnt ?? 0 } });
  }

  if (tab === "chats") {
    const chats = await db.execute<{
      id: number; topic_id: number; keyword: string | null; message_count: number;
      ai_provider: string | null; total_tokens: number; messages: unknown;
      created_at: string; updated_at: string; topic_title: string; chapter_title: string;
      subject_name: string; subject_id: number; grade: number; board_code: string;
    }>(sql`
      SELECT tc.id, tc.topic_id, tc.keyword, tc.message_count, tc.ai_provider, tc.total_tokens,
        tc.messages, tc.created_at::text, tc.updated_at::text,
        t.title AS topic_title, ch.title AS chapter_title,
        s.name AS subject_name, s.id AS subject_id, st.grade, b.code AS board_code
      FROM topic_conversations tc
      JOIN topics t ON t.id = tc.topic_id
      JOIN chapters ch ON ch.id = t.chapter_id
      JOIN subjects s ON s.id = ch.subject_id
      JOIN standards st ON st.id = s.standard_id
      JOIN boards b ON b.id = st.board_id
      WHERE tc.user_id = ${userId} ${searchFilter} ${subjectFilter}
      ORDER BY tc.updated_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `);

    const [countResult] = await db.execute<{ cnt: number }>(sql`
      SELECT count(*)::int as cnt FROM topic_conversations tc
      JOIN topics t ON t.id = tc.topic_id JOIN chapters ch ON ch.id = t.chapter_id
      JOIN subjects s ON s.id = ch.subject_id
      WHERE tc.user_id = ${userId} ${searchFilter} ${subjectFilter}
    `);

    return NextResponse.json({ success: true, data: { items: [...chats], total: countResult?.cnt ?? 0 } });
  }

  if (tab === "exams") {
    const exams = await db.execute<{
      attempt_id: number; exam_id: number; title: string; total_score: string | null;
      max_score: string | null; percentage: string | null; grade: string | null;
      status: string; attempt_number: number; started_at: string | null; submitted_at: string | null;
      topic_id: number; topic_title: string; subject_name: string; subject_id: number;
      chapter_title: string; board_code: string; grade_level: number;
    }>(sql`
      SELECT ea.id AS attempt_id, e.id AS exam_id, e.title, ea.total_score, ea.max_score,
        ea.percentage, ea.grade, ea.status, ea.attempt_number,
        ea.started_at::text, ea.submitted_at::text,
        t.id AS topic_id, t.title AS topic_title, s.name AS subject_name, s.id AS subject_id,
        ch.title AS chapter_title, b.code AS board_code, st.grade AS grade_level
      FROM exam_attempts ea
      JOIN exams e ON e.id = ea.exam_id
      LEFT JOIN topics t ON t.id = (e.topic_ids[1])
      LEFT JOIN chapters ch ON ch.id = t.chapter_id
      LEFT JOIN subjects s ON s.id = ch.subject_id
      LEFT JOIN standards st ON st.id = s.standard_id
      LEFT JOIN boards b ON b.id = st.board_id
      WHERE ea.user_id = ${userId} AND e.exam_type = 'self_test'
      ${subjectId ? sql`AND s.id = ${parseInt(subjectId, 10)}` : sql``}
      ORDER BY ea.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `);

    // Exam summary by subject
    const examSummary = await db.execute<{
      subject_name: string; subject_id: number; exam_count: number;
      avg_percentage: number; best_percentage: number; total_score_sum: number; max_score_sum: number;
    }>(sql`
      SELECT s.name AS subject_name, s.id AS subject_id,
        count(*)::int AS exam_count,
        round(avg(ea.percentage::numeric))::int AS avg_percentage,
        round(max(ea.percentage::numeric))::int AS best_percentage,
        round(sum(ea.total_score::numeric))::int AS total_score_sum,
        round(sum(ea.max_score::numeric))::int AS max_score_sum
      FROM exam_attempts ea
      JOIN exams e ON e.id = ea.exam_id
      LEFT JOIN topics t ON t.id = (e.topic_ids[1])
      LEFT JOIN chapters ch ON ch.id = t.chapter_id
      LEFT JOIN subjects s ON s.id = ch.subject_id
      WHERE ea.user_id = ${userId} AND e.exam_type = 'self_test' AND ea.status = 'submitted'
      GROUP BY s.name, s.id
      ORDER BY exam_count DESC
    `);

    const [countResult] = await db.execute<{ cnt: number }>(sql`
      SELECT count(*)::int as cnt FROM exam_attempts ea
      JOIN exams e ON e.id = ea.exam_id
      WHERE ea.user_id = ${userId} AND e.exam_type = 'self_test'
    `);

    return NextResponse.json({ success: true, data: { items: [...exams], total: countResult?.cnt ?? 0, summary: [...examSummary] } });
  }

  if (tab === "videos") {
    const videos = await db.execute<{
      id: number; topic_id: number; youtube_url: string; title: string | null;
      thumbnail_url: string | null; created_at: string; topic_title: string;
      chapter_title: string; subject_name: string; subject_id: number;
    }>(sql`
      SELECT uv.id, uv.topic_id, uv.youtube_url, uv.title, uv.thumbnail_url,
        uv.created_at::text AS created_at,
        t.title AS topic_title, ch.title AS chapter_title,
        s.name AS subject_name, s.id AS subject_id
      FROM user_videos uv
      JOIN topics t ON t.id = uv.topic_id
      JOIN chapters ch ON ch.id = t.chapter_id
      JOIN subjects s ON s.id = ch.subject_id
      WHERE uv.user_id = ${userId} ${searchFilter} ${subjectFilter}
      ORDER BY uv.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `);

    const [countResult] = await db.execute<{ cnt: number }>(sql`
      SELECT count(*)::int as cnt FROM user_videos uv
      JOIN topics t ON t.id = uv.topic_id
      JOIN chapters ch ON ch.id = t.chapter_id
      JOIN subjects s ON s.id = ch.subject_id
      WHERE uv.user_id = ${userId} ${searchFilter} ${subjectFilter}
    `);

    return NextResponse.json({ success: true, data: { items: [...videos], total: countResult?.cnt ?? 0 } });
  }

  return NextResponse.json({ success: false, error: { code: "INVALID_TAB", message: "Tab must be notes, chats, exams, or videos" } }, { status: 400 });
}
