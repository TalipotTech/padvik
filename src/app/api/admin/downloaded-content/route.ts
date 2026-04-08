import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { sql } from "drizzle-orm";

/**
 * GET /api/admin/downloaded-content?source=ncert&jobId=21
 *
 * Lists content_items that were created by content pipelines (NCERT download,
 * DIKSHA ingest, Kerala scrape, AI generation, etc.) with full metadata,
 * parse status, and links to source PDFs.
 */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Admin access required" } },
      { status: 403 }
    );
  }

  const url = new URL(request.url);
  const sourceFilter = url.searchParams.get("source"); // ncert, diksha, kerala_scert, ai_generated, etc.
  const jobIdFilter = url.searchParams.get("jobId");
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "100", 10), 500);

  try {
    // Get content items with full hierarchy context
    const items = await db.execute<{
      id: number;
      title: string;
      content_type: string;
      source_type: string;
      source_url: string | null;
      language: string;
      quality_score: string | null;
      review_status: string;
      is_published: boolean;
      body_length: number;
      created_at: string;
      topic_title: string;
      chapter_title: string;
      chapter_number: number;
      subject_name: string;
      grade: number;
      board_code: string;
      metadata: Record<string, unknown> | null;
    }>(sql`
      SELECT
        ci.id,
        ci.title,
        ci.content_type,
        ci.source_type,
        ci.source_url,
        ci.language,
        ci.quality_score,
        ci.review_status,
        ci.is_published,
        length(ci.body)::int AS body_length,
        ci.created_at::text,
        t.title AS topic_title,
        ch.title AS chapter_title,
        ch.chapter_number,
        s.name AS subject_name,
        st.grade,
        b.code AS board_code,
        ci.metadata
      FROM content_items ci
      JOIN topics t ON t.id = ci.topic_id
      JOIN chapters ch ON ch.id = t.chapter_id
      JOIN subjects s ON s.id = ch.subject_id
      JOIN standards st ON st.id = s.standard_id
      JOIN boards b ON b.id = st.board_id
      WHERE 1=1
      ${sourceFilter ? sql`AND ci.source_type = ${sourceFilter}` : sql``}
      ${jobIdFilter ? sql`AND (ci.metadata->>'scrapeJobId')::text = ${jobIdFilter}` : sql``}
      ORDER BY ci.created_at DESC
      LIMIT ${limit}
    `);

    // Summary stats by source type
    const summary = await db.execute<{
      source_type: string;
      count: number;
      total_body_length: number;
      published: number;
      pending: number;
      avg_quality: number;
    }>(sql`
      SELECT
        source_type,
        count(*)::int AS count,
        sum(length(body))::int AS total_body_length,
        count(*) FILTER (WHERE is_published = true)::int AS published,
        count(*) FILTER (WHERE review_status = 'pending')::int AS pending,
        round(avg(quality_score::numeric), 2)::float AS avg_quality
      FROM content_items
      GROUP BY source_type
      ORDER BY count DESC
    `);

    // Per-job breakdown — match content items by scrapeJobId in metadata
    // OR by timing (content created between job start and completion)
    const byJob = await db.execute<{
      job_id: number;
      job_type: string;
      status: string;
      items_found: number;
      items_processed: number;
      content_count: number;
      total_body_length: number;
      created_at: string;
      started_at: string | null;
      completed_at: string | null;
    }>(sql`
      SELECT
        sj.id AS job_id,
        sj.job_type,
        sj.status,
        sj.items_found,
        sj.items_processed,
        COALESCE(ci_agg.content_count, 0)::int AS content_count,
        COALESCE(ci_agg.total_body_length, 0)::int AS total_body_length,
        sj.created_at::text,
        sj.started_at::text,
        sj.completed_at::text
      FROM scrape_jobs sj
      LEFT JOIN LATERAL (
        SELECT
          count(*)::int AS content_count,
          COALESCE(sum(length(ci.body)), 0)::int AS total_body_length
        FROM content_items ci
        WHERE (
          -- Match by explicit job ID in metadata
          (ci.metadata->>'scrapeJobId' IS NOT NULL AND (ci.metadata->>'scrapeJobId')::int = sj.id)
          OR
          -- Match by source type + timing window (for items without scrapeJobId)
          (
            sj.started_at IS NOT NULL
            AND ci.created_at >= sj.started_at
            AND ci.created_at <= COALESCE(sj.completed_at, NOW())
            AND (
              (sj.job_type = 'ncert_download' AND ci.source_type = 'ncert')
              OR (sj.job_type = 'diksha_ingest' AND ci.source_type = 'diksha')
              OR (sj.job_type = 'kerala_scrape' AND ci.source_type = 'kerala_scert')
              OR (sj.job_type = 'content_generate' AND ci.source_type = 'ai_generated')
            )
          )
        )
      ) ci_agg ON true
      WHERE sj.job_type IN ('ncert_download', 'diksha_ingest', 'kerala_scrape', 'content_generate', 'state_board_scrape')
      ORDER BY sj.created_at DESC
      LIMIT 20
    `);

    return NextResponse.json({
      success: true,
      data: {
        items: [...items],
        summary: [...summary],
        byJob: [...byJob],
        totalItems: [...items].length,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: { code: "QUERY_ERROR", message: err instanceof Error ? err.message : String(err) } },
      { status: 500 }
    );
  }
}
