import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { eq, sql } from "drizzle-orm";
import { subjects } from "@/db/schema/curriculum";
import { scrapeJobs } from "@/db/schema/system";
import { z } from "zod/v4";
import { runCbseContentFill } from "@/lib/scraper/cbse-content-fill";

/**
 * /api/admin/content/fill-gaps
 * ----------------------------------------------------------------------------
 * GET  — report the gap (topics without content_items) for a subject.
 * POST — run the fill-gaps pipeline. Two modes:
 *   • Default (synchronous): does the work inline, returns the final counts.
 *     Used by the student-facing syllabus explorer which expects a single
 *     response. Slow for large subjects but OK for small ones.
 *   • { async: true }: inserts a scrape_jobs row, enqueues a BullMQ job, and
 *     returns { jobId, queueJobId, status: "queued" } for the client to
 *     poll via /api/admin/scrape-jobs/{id}. Used by the Coverage page's
 *     JobStatusCard so the UI stays responsive during long runs.
 *
 * The actual extraction logic lives in src/lib/scraper/cbse-content-fill.ts;
 * this file only owns the HTTP transport and the sync/async dispatch.
 */

export async function GET(request: NextRequest) {
  const session = await auth();
  const isAdmin = session?.user?.role === "admin" || process.env.NODE_ENV === "development";
  if (!isAdmin) {
    return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Admin access required" } }, { status: 403 });
  }

  const subjectId = request.nextUrl.searchParams.get("subjectId");
  if (!subjectId) {
    return NextResponse.json({ success: false, error: { code: "MISSING_PARAM", message: "subjectId required" } }, { status: 400 });
  }

  const sid = parseInt(subjectId, 10);

  // Topic inventory with per-chapter PDF-path discovery. Priority:
  //   content_items.metadata.pdfPath → chapters.metadata.sourcePdf →
  //   subjects.metadata.sourcePdf. The latter two mean CBSE-scraped
  //   subjects still show their PDF before any content_items exist.
  const topicRows = await db.execute<{
    topic_id: number;
    topic_title: string;
    chapter_number: number;
    chapter_title: string;
    content_count: number;
    chapter_pdf_path: string | null;
  }>(sql`
    SELECT
      t.id AS topic_id,
      t.title AS topic_title,
      ch.chapter_number,
      ch.title AS chapter_title,
      (SELECT count(*)::int FROM content_items ci WHERE ci.topic_id = t.id) AS content_count,
      COALESCE(
        (SELECT ci2.metadata->>'pdfPath' FROM content_items ci2 JOIN topics t2 ON t2.id = ci2.topic_id WHERE t2.chapter_id = ch.id AND ci2.metadata->>'pdfPath' IS NOT NULL LIMIT 1),
        ch.metadata->>'sourcePdf',
        s.metadata->>'sourcePdf'
      ) AS chapter_pdf_path
    FROM topics t
    JOIN chapters ch ON ch.id = t.chapter_id
    JOIN subjects s ON s.id = ch.subject_id
    WHERE ch.subject_id = ${sid}
    ORDER BY ch.chapter_number, t.sort_order
  `);

  const allTopics = [...topicRows];
  const missingTopics = allTopics.filter((t) => t.content_count === 0);
  const withPdf = missingTopics.filter((t) => t.chapter_pdf_path !== null);

  const [subj] = await db.select({ name: subjects.name, code: subjects.code }).from(subjects).where(eq(subjects.id, sid)).limit(1);

  const estimatedCost = withPdf.length * 0.003 + (missingTopics.length - withPdf.length) * 0.005;

  return NextResponse.json({
    success: true,
    data: {
      subject: subj,
      totalTopics: allTopics.length,
      topicsWithContent: allTopics.filter((t) => t.content_count > 0).length,
      topicsMissing: missingTopics.length,
      topicsWithPdf: withPdf.length,
      topicsWithoutPdf: missingTopics.length - withPdf.length,
      estimatedCostUsd: Math.round(estimatedCost * 100) / 100,
      missingTopics: missingTopics.map((t) => ({
        topicId: t.topic_id,
        title: t.topic_title,
        chapter: `Ch ${t.chapter_number}: ${t.chapter_title}`,
        hasPdf: t.chapter_pdf_path !== null,
        pdfPath: t.chapter_pdf_path,
      })),
    },
  });
}

const fillSchema = z.object({
  subjectId: z.number().int(),
  topicIds: z.array(z.number().int()).optional(),
  limit: z.number().int().min(1).max(500).optional(),
  dryRun: z.boolean().optional(),
  notes: z.boolean().optional(),
  /** Opt in to async BullMQ execution (see file-level docstring). */
  async: z.boolean().optional(),
});

export async function POST(request: NextRequest) {
  const session = await auth();
  const isAdmin = session?.user?.role === "admin" || process.env.NODE_ENV === "development";
  if (!isAdmin) {
    return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Admin access required" } }, { status: 403 });
  }

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ success: false, error: { code: "INVALID_JSON", message: "Invalid JSON" } }, { status: 400 });
  }

  const parsed = fillSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } }, { status: 400 });
  }

  const { subjectId, topicIds, limit: maxTopics, dryRun, async: asyncMode } = parsed.data;

  // ---------------------------------------------------------------------
  // Dry-run short-circuit — cheap estimate, no job, no work.
  // ---------------------------------------------------------------------
  if (dryRun) {
    const dryRows = await db.execute<{
      count: number;
      with_pdf: number;
    }>(sql`
      SELECT
        count(*)::int AS count,
        count(CASE WHEN COALESCE(
          (SELECT ci2.metadata->>'pdfPath' FROM content_items ci2 JOIN topics t2 ON t2.id = ci2.topic_id WHERE t2.chapter_id = ch.id AND ci2.metadata->>'pdfPath' IS NOT NULL LIMIT 1),
          ch.metadata->>'sourcePdf',
          s.metadata->>'sourcePdf'
        ) IS NOT NULL THEN 1 END)::int AS with_pdf
      FROM topics t
      JOIN chapters ch ON ch.id = t.chapter_id
      JOIN subjects s ON s.id = ch.subject_id
      WHERE ch.subject_id = ${subjectId}
        AND NOT EXISTS (SELECT 1 FROM content_items ci WHERE ci.topic_id = t.id)
      LIMIT ${maxTopics ?? 50}
    `);
    const row = dryRows[0] ?? { count: 0, with_pdf: 0 };
    const candidate = topicIds ? Math.min(row.count, topicIds.length) : row.count;
    return NextResponse.json({
      success: true,
      data: {
        dryRun: true,
        topicsToProcess: candidate,
        withPdf: row.with_pdf,
        withoutPdf: candidate - row.with_pdf,
        estimatedCostUsd: Math.round(candidate * 0.004 * 100) / 100,
      },
    });
  }

  // ---------------------------------------------------------------------
  // Async mode — insert scrape_jobs row + enqueue. Returns immediately so
  // the UI can start polling. Only reachable when the caller opted in.
  // ---------------------------------------------------------------------
  if (asyncMode) {
    // Guard against re-queuing the same subject while a job is already in
    // flight. Dedup window: any queued/running cbse_content_fill row whose
    // metadata.subjectId matches.
    const existing = await db.execute<{ id: number; status: string }>(sql`
      SELECT id, status FROM scrape_jobs
      WHERE job_type = 'cbse_content_fill'
        AND status IN ('queued', 'running')
        AND metadata->>'subjectId' = ${String(subjectId)}
      ORDER BY id DESC
      LIMIT 1
    `);
    const existingRow = existing[0];
    if (existingRow) {
      return NextResponse.json({
        success: true,
        data: {
          status: "already_running",
          jobId: existingRow.id,
          queueJobId: null,
          message: `A cbse_content_fill job for subject ${subjectId} is already ${existingRow.status}.`,
        },
      });
    }

    // Subject-name lookup so the scrape_jobs metadata carries human context.
    const [subj] = await db
      .select({ id: subjects.id, name: subjects.name })
      .from(subjects)
      .where(eq(subjects.id, subjectId))
      .limit(1);

    const [job] = await db
      .insert(scrapeJobs)
      .values({
        jobType: "cbse_content_fill",
        sourceUrl: `internal://fill-gaps/subject/${subjectId}`,
        status: "queued",
        metadata: {
          subjectId,
          subjectName: subj?.name ?? null,
          topicIds: topicIds ?? null,
          limit: maxTopics ?? 50,
          triggeredBy: session?.user?.email ?? session?.user?.id ?? "anonymous",
          triggeredAt: new Date().toISOString(),
        },
      })
      .returning();

    const { addCbseContentFillJob } = await import("@/lib/queue");
    const queueJobId = await addCbseContentFillJob({
      jobId: job.id,
      subjectId,
      topicIds,
      limit: maxTopics,
    });

    await db
      .update(scrapeJobs)
      .set({
        metadata: {
          ...(job.metadata as Record<string, unknown>),
          queueJobId,
        },
      })
      .where(eq(scrapeJobs.id, job.id));

    return NextResponse.json({
      success: true,
      data: {
        status: "queued",
        jobId: job.id,
        queueJobId,
        message: `Fill-gaps queued — watch progress on /scrape-jobs (Job #${job.id}).`,
      },
    });
  }

  // ---------------------------------------------------------------------
  // Default sync mode. Blocks the request until done; suitable for small
  // subjects (the syllabus-explorer uses limit:50).
  // ---------------------------------------------------------------------
  const result = await runCbseContentFill({
    subjectId,
    topicIds,
    limit: maxTopics,
  });

  return NextResponse.json({
    success: true,
    data: {
      processed: result.processed,
      totalCostUsd: result.totalCostUsd,
      errors: result.errors,
    },
  });
}
