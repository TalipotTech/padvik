import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { schools } from "@/db/schema/schools";
import { sql } from "drizzle-orm";

/**
 * POST /api/admin/schools/import — Queue a school import job via BullMQ
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session || (session.user as { role?: string }).role !== "admin") {
    return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Admin required" } }, { status: 403 });
  }

  let body: { source: string; stateFilter?: string };
  try { body = await request.json(); } catch {
    return NextResponse.json({ success: false, error: { code: "INVALID_JSON", message: "Invalid JSON" } }, { status: 400 });
  }

  try {
    const { addSchoolImportJob } = await import("@/lib/queue/index");
    const jobId = await addSchoolImportJob({ source: body.source, stateFilter: body.stateFilter });
    return NextResponse.json({
      success: true,
      data: { jobId, source: body.source, message: "Import job queued. Ensure workers are running: pnpm workers" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[schools-import] Queue error:", msg);
    return NextResponse.json({
      success: false,
      error: { code: "QUEUE_ERROR", message: `Failed to queue job. Is Redis running? Error: ${msg}` },
    }, { status: 500 });
  }
}

/**
 * GET /api/admin/schools/import — Get import job statuses + DB counts
 */
export async function GET() {
  const session = await auth();
  if (!session || (session.user as { role?: string }).role !== "admin") {
    return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Admin required" } }, { status: 403 });
  }

  // Get DB counts by source
  const [total] = await db.select({ count: sql<number>`count(*)::int` }).from(schools);
  const bySrc = await db.select({ source: schools.source, count: sql<number>`count(*)::int` }).from(schools).groupBy(schools.source);

  // Get recent jobs from BullMQ queue
  const jobs: Array<{ id: string; source: string; state: string; progress: unknown; result: unknown; failedReason?: string; startedAt?: number; finishedAt?: number }> = [];

  try {
    const { getSchoolImportQueue } = await import("@/lib/queue/index");
    const queue = getSchoolImportQueue();
    const recentJobs = await queue.getJobs(["active", "completed", "failed", "waiting"], 0, 10);

    for (const job of recentJobs) {
      const state = await job.getState();
      jobs.push({
        id: job.id ?? "",
        source: job.data.source,
        state,
        progress: job.progress,
        result: job.returnvalue,
        failedReason: job.failedReason,
        startedAt: job.processedOn,
        finishedAt: job.finishedOn,
      });
    }
  } catch {
    // Redis not available — just return DB counts
  }

  return NextResponse.json({
    success: true,
    data: {
      jobs,
      dbCounts: {
        total: total?.count ?? 0,
        bySource: Object.fromEntries(bySrc.map(s => [s.source, s.count])),
      },
    },
  });
}
