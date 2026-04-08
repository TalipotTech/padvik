import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { sql } from "drizzle-orm";

/**
 * GET /api/learn/dashboard?boardId=1&grade=10
 * Returns My Learning dashboard data — subjects with progress and latest activity.
 */
export async function GET(request: NextRequest) {
  let userId: number | null = null;
  try {
    const session = await auth();
    userId = session?.user?.id ? Number(session.user.id) : null;
  } catch { /* auth failed */ }
  // Dev fallback
  if (!userId && process.env.NODE_ENV === "development") userId = 1;
  if (!userId) {
    return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Login required" } }, { status: 401 });
  }

  const boardId = request.nextUrl.searchParams.get("boardId");
  const grade = request.nextUrl.searchParams.get("grade");

  if (!boardId || !grade) {
    return NextResponse.json({ success: false, error: { code: "MISSING_PARAMS", message: "boardId and grade required" } }, { status: 400 });
  }

  // Get subjects with aggregated progress
  const subjectProgress = await db.execute<{
    subject_id: number;
    subject_name: string;
    subject_code: string;
    chapter_count: number;
    topic_count: number;
    content_count: number;
    avg_completion: number;
    latest_topic_id: number | null;
    latest_topic_title: string | null;
    latest_chapter_title: string | null;
    latest_read_at: string | null;
    understanding_counts: unknown;
  }>(sql`
    SELECT
      s.id AS subject_id,
      s.name AS subject_name,
      s.code AS subject_code,
      (SELECT count(*)::int FROM chapters WHERE subject_id = s.id) AS chapter_count,
      (SELECT count(*)::int FROM topics t2 JOIN chapters c2 ON c2.id = t2.chapter_id WHERE c2.subject_id = s.id) AS topic_count,
      (SELECT count(*)::int FROM content_items ci2 JOIN topics t3 ON t3.id = ci2.topic_id JOIN chapters c3 ON c3.id = t3.chapter_id WHERE c3.subject_id = s.id AND ci2.is_published = true) AS content_count,
      COALESCE(
        (SELECT avg(rp.completion_percent)::int FROM reading_progress rp
         JOIN content_items ci ON ci.id = rp.content_item_id
         JOIN topics t ON t.id = ci.topic_id
         JOIN chapters c ON c.id = t.chapter_id
         WHERE c.subject_id = s.id AND rp.user_id = ${userId}), 0
      ) AS avg_completion,
      (SELECT t.id FROM reading_progress rp
       JOIN content_items ci ON ci.id = rp.content_item_id
       JOIN topics t ON t.id = ci.topic_id
       JOIN chapters c ON c.id = t.chapter_id
       WHERE c.subject_id = s.id AND rp.user_id = ${userId}
       ORDER BY rp.last_read_at DESC LIMIT 1) AS latest_topic_id,
      (SELECT t.title FROM reading_progress rp
       JOIN content_items ci ON ci.id = rp.content_item_id
       JOIN topics t ON t.id = ci.topic_id
       JOIN chapters c ON c.id = t.chapter_id
       WHERE c.subject_id = s.id AND rp.user_id = ${userId}
       ORDER BY rp.last_read_at DESC LIMIT 1) AS latest_topic_title,
      (SELECT c.title FROM reading_progress rp
       JOIN content_items ci ON ci.id = rp.content_item_id
       JOIN topics t ON t.id = ci.topic_id
       JOIN chapters c ON c.id = t.chapter_id
       WHERE c.subject_id = s.id AND rp.user_id = ${userId}
       ORDER BY rp.last_read_at DESC LIMIT 1) AS latest_chapter_title,
      (SELECT rp.last_read_at::text FROM reading_progress rp
       JOIN content_items ci ON ci.id = rp.content_item_id
       JOIN topics t ON t.id = ci.topic_id
       JOIN chapters c ON c.id = t.chapter_id
       WHERE c.subject_id = s.id AND rp.user_id = ${userId}
       ORDER BY rp.last_read_at DESC LIMIT 1) AS latest_read_at,
      (SELECT json_build_object(
        'red', count(*) FILTER (WHERE tu.understanding_level = 'red'),
        'orange', count(*) FILTER (WHERE tu.understanding_level = 'orange'),
        'green', count(*) FILTER (WHERE tu.understanding_level = 'green')
      ) FROM topic_understanding tu
       JOIN topics t ON t.id = tu.topic_id
       JOIN chapters c ON c.id = t.chapter_id
       WHERE c.subject_id = s.id AND tu.user_id = ${userId}) AS understanding_counts
    FROM subjects s
    JOIN standards st ON st.id = s.standard_id
    WHERE st.board_id = ${parseInt(boardId, 10)}
      AND st.grade = ${parseInt(grade, 10)}
    ORDER BY s.name
  `);

  // Recent activity — notes, videos, conversations, highlights
  const recentActivity = await db.execute<{
    type: string;
    topic_id: number;
    topic_title: string;
    subject_name: string;
    chapter_title: string;
    preview: string;
    created_at: string;
  }>(sql`
    (
      SELECT 'note' AS type, un.topic_id, t.title AS topic_title, s.name AS subject_name,
        ch.title AS chapter_title, left(un.body, 100) AS preview, un.created_at::text
      FROM user_notes un
      JOIN topics t ON t.id = un.topic_id
      JOIN chapters ch ON ch.id = t.chapter_id
      JOIN subjects s ON s.id = ch.subject_id
      WHERE un.user_id = ${userId}
      ORDER BY un.created_at DESC LIMIT 5
    )
    UNION ALL
    (
      SELECT 'video' AS type, uv.topic_id, t.title AS topic_title, s.name AS subject_name,
        ch.title AS chapter_title, COALESCE(uv.title, uv.youtube_url) AS preview, uv.created_at::text
      FROM user_videos uv
      JOIN topics t ON t.id = uv.topic_id
      JOIN chapters ch ON ch.id = t.chapter_id
      JOIN subjects s ON s.id = ch.subject_id
      WHERE uv.user_id = ${userId}
      ORDER BY uv.created_at DESC LIMIT 5
    )
    UNION ALL
    (
      SELECT 'chat' AS type, tc.topic_id, t.title AS topic_title, s.name AS subject_name,
        ch.title AS chapter_title, COALESCE(tc.keyword, 'AI Chat') AS preview, tc.updated_at::text AS created_at
      FROM topic_conversations tc
      JOIN topics t ON t.id = tc.topic_id
      JOIN chapters ch ON ch.id = t.chapter_id
      JOIN subjects s ON s.id = ch.subject_id
      WHERE tc.user_id = ${userId}
      ORDER BY tc.updated_at DESC LIMIT 5
    )
    UNION ALL
    (
      SELECT 'highlight' AS type, t.id AS topic_id, t.title AS topic_title, s.name AS subject_name,
        ch.title AS chapter_title, left(uh.highlighted_text, 100) AS preview, uh.created_at::text
      FROM user_highlights uh
      JOIN content_items ci ON ci.id = uh.content_item_id
      JOIN topics t ON t.id = ci.topic_id
      JOIN chapters ch ON ch.id = t.chapter_id
      JOIN subjects s ON s.id = ch.subject_id
      WHERE uh.user_id = ${userId}
      ORDER BY uh.created_at DESC LIMIT 5
    )
    ORDER BY created_at DESC
    LIMIT 15
  `);

  // Separate detailed lists for each section
  const recentVideos = await db.execute<{
    id: number; topic_id: number; youtube_url: string; title: string | null;
    thumbnail_url: string | null; topic_title: string; subject_name: string;
    chapter_title: string; created_at: string;
  }>(sql`
    SELECT uv.id, uv.topic_id, uv.youtube_url, uv.title, uv.thumbnail_url,
      t.title AS topic_title, s.name AS subject_name, ch.title AS chapter_title, uv.created_at::text
    FROM user_videos uv
    JOIN topics t ON t.id = uv.topic_id JOIN chapters ch ON ch.id = t.chapter_id
    JOIN subjects s ON s.id = ch.subject_id
    WHERE uv.user_id = ${userId} ORDER BY uv.created_at DESC LIMIT 6
  `);

  const recentNotes = await db.execute<{
    id: number; topic_id: number; title: string | null; body: string;
    topic_title: string; subject_name: string; chapter_title: string; created_at: string;
  }>(sql`
    SELECT un.id, un.topic_id, un.title, left(un.body, 200) AS body,
      t.title AS topic_title, s.name AS subject_name, ch.title AS chapter_title, un.created_at::text
    FROM user_notes un
    JOIN topics t ON t.id = un.topic_id JOIN chapters ch ON ch.id = t.chapter_id
    JOIN subjects s ON s.id = ch.subject_id
    WHERE un.user_id = ${userId} ORDER BY un.created_at DESC LIMIT 10
  `);

  const recentChats = await db.execute<{
    id: number; topic_id: number; keyword: string | null; message_count: number;
    ai_provider: string | null; topic_title: string; subject_name: string;
    chapter_title: string; updated_at: string; messages: unknown;
  }>(sql`
    SELECT tc.id, tc.topic_id, tc.keyword, tc.message_count, tc.ai_provider,
      t.title AS topic_title, s.name AS subject_name, ch.title AS chapter_title, tc.updated_at::text,
      tc.messages
    FROM topic_conversations tc
    JOIN topics t ON t.id = tc.topic_id JOIN chapters ch ON ch.id = t.chapter_id
    JOIN subjects s ON s.id = ch.subject_id
    WHERE tc.user_id = ${userId} ORDER BY tc.updated_at DESC LIMIT 10
  `);

  // Exam history
  const recentExams = await db.execute<{
    attempt_id: number; title: string; total_score: string | null; max_score: string | null;
    percentage: string | null; grade: string | null; status: string;
    submitted_at: string | null; topic_title: string; subject_name: string; topic_id: number;
  }>(sql`
    SELECT ea.id AS attempt_id, e.title, ea.total_score, ea.max_score, ea.percentage, ea.grade,
      ea.status, ea.submitted_at::text, t.title AS topic_title, s.name AS subject_name, t.id AS topic_id
    FROM exam_attempts ea
    JOIN exams e ON e.id = ea.exam_id
    LEFT JOIN topics t ON t.id = (e.topic_ids[1])
    LEFT JOIN chapters ch ON ch.id = t.chapter_id
    LEFT JOIN subjects s ON s.id = ch.subject_id
    WHERE ea.user_id = ${userId} AND e.exam_type = 'self_test'
    ORDER BY ea.created_at DESC LIMIT 10
  `);

  return NextResponse.json({
    success: true,
    data: {
      subjects: [...subjectProgress],
      recentActivity: [...recentActivity],
      recentVideos: [...recentVideos],
      recentNotes: [...recentNotes],
      recentChats: [...recentChats],
      recentExams: [...recentExams],
    },
  });
}
