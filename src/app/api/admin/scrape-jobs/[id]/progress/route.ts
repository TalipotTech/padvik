import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

/**
 * GET /api/admin/scrape-jobs/:id/progress
 *
 * Reads job progress directly from BullMQ (not the database).
 * Returns the BullMQ job state and progress object set by the worker.
 * Frontend polls this every 2 seconds for active jobs.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Admin access required" } },
      { status: 403 }
    );
  }

  const { id: queueJobId } = await params;

  try {
    const { getScrapeQueue } = await import("@/lib/queue");
    const queue = getScrapeQueue();
    const job = await queue.getJob(queueJobId);

    if (!job) {
      return NextResponse.json({
        success: true,
        data: { state: null, progress: null, failedReason: null },
      });
    }

    const state = await job.getState();
    const progress = job.progress ?? null;
    const failedReason = job.failedReason ?? null;

    return NextResponse.json({
      success: true,
      data: { state, progress, failedReason },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({
      success: true,
      data: { state: null, progress: null, failedReason: null },
      error: { code: "QUEUE_UNAVAILABLE", message },
    });
  }
}
