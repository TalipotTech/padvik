import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { sql } from "drizzle-orm";

/**
 * GET /api/admin/pipeline-stats
 * Returns aggregate stats for the pipeline dashboard:
 * - Content counts by source_type
 * - Question counts
 * - Coverage matrix (board × grade)
 * - Recent pipeline logs
 * - Active/recent jobs
 */
export async function GET() {
  const session = await auth();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Admin access required" } },
      { status: 403 }
    );
  }

  // Run all queries in parallel
  const [contentStats, questionStats, coverageMatrix, recentLogs, activeJobs, aiUsage] = await Promise.all([
    // Content counts by source_type
    db.execute<{ source_type: string; count: number; published: number }>(sql`
      SELECT source_type,
        COUNT(*)::int AS count,
        COUNT(*) FILTER (WHERE is_published = true)::int AS published
      FROM content_items
      GROUP BY source_type
      ORDER BY count DESC
    `),

    // Question counts by source_type and difficulty
    db.execute<{ source_type: string; difficulty: string; count: number }>(sql`
      SELECT source_type, difficulty, COUNT(*)::int AS count
      FROM questions
      GROUP BY source_type, difficulty
      ORDER BY source_type, difficulty
    `),

    // Coverage matrix: board × grade → topic count + content count
    db.execute<{ board_code: string; board_name: string; grade: number; topic_count: number; content_count: number; question_count: number }>(sql`
      SELECT
        b.code AS board_code,
        b.name AS board_name,
        st.grade,
        COUNT(DISTINCT t.id)::int AS topic_count,
        COUNT(DISTINCT ci.id)::int AS content_count,
        COUNT(DISTINCT q.id)::int AS question_count
      FROM boards b
      JOIN standards st ON st.board_id = b.id
      JOIN subjects s ON s.standard_id = st.id
      JOIN chapters ch ON ch.subject_id = s.id
      JOIN topics t ON t.chapter_id = ch.id
      LEFT JOIN content_items ci ON ci.topic_id = t.id
      LEFT JOIN questions q ON q.topic_id = t.id
      WHERE b.is_active = true
      GROUP BY b.code, b.name, st.grade
      ORDER BY b.code, st.grade
    `),

    // Recent pipeline logs (last 20)
    db.execute<{ id: number; pipeline_stage: string; entity_type: string; status: string; ai_model_used: string | null; ai_provider: string | null; processing_time_ms: number | null; created_at: string }>(sql`
      SELECT id, pipeline_stage, entity_type, status, ai_model_used, ai_provider, processing_time_ms, created_at
      FROM content_pipeline_logs
      ORDER BY created_at DESC
      LIMIT 20
    `),

    // Active and recent jobs
    db.execute<{ id: number; job_type: string; status: string; items_found: number; items_processed: number; created_at: string; metadata: unknown }>(sql`
      SELECT id, job_type, status, items_found, items_processed, created_at, metadata
      FROM scrape_jobs
      ORDER BY created_at DESC
      LIMIT 15
    `),

    // AI usage today — costs and tokens per model
    db.execute<{ ai_model_used: string; ai_provider: string | null; call_count: number; total_tokens: number; total_cost: number }>(sql`
      SELECT
        COALESCE(ai_model_used, 'unknown') AS ai_model_used,
        ai_provider,
        COUNT(*)::int AS call_count,
        COALESCE(SUM(ai_tokens_used), 0)::int AS total_tokens,
        COALESCE(SUM((output_data->>'costUsd')::numeric), 0)::numeric AS total_cost
      FROM content_pipeline_logs
      WHERE created_at >= NOW() - INTERVAL '24 hours'
        AND ai_model_used IS NOT NULL
      GROUP BY ai_model_used, ai_provider
      ORDER BY total_cost DESC
    `),
  ]);

  // Aggregate content totals
  const totalContent = [...contentStats].reduce((sum, r) => sum + r.count, 0);
  const totalPublished = [...contentStats].reduce((sum, r) => sum + r.published, 0);
  const totalQuestions = [...questionStats].reduce((sum, r) => sum + r.count, 0);

  return NextResponse.json({
    success: true,
    data: {
      totals: {
        contentItems: totalContent,
        publishedItems: totalPublished,
        questions: totalQuestions,
      },
      contentBySource: [...contentStats],
      questionsBySource: [...questionStats],
      coverageMatrix: [...coverageMatrix],
      recentLogs: [...recentLogs],
      activeJobs: [...activeJobs],
      aiUsageToday: [...aiUsage],
    },
  });
}
