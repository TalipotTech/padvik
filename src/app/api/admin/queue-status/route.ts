import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

// ---------------------------------------------------------------------------
// GET /api/admin/queue-status — Get queue job counts
// ---------------------------------------------------------------------------
export async function GET() {
  const session = await auth();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Admin access required" } },
      { status: 403 }
    );
  }

  try {
    // Dynamic import so this endpoint doesn't break if Redis isn't running
    const { getScrapeQueue, getContentQueue, getFileQueue } = await import("@/lib/queue");

    const [scrapeCounts, contentCounts, fileCounts] = await Promise.all([
      getScrapeQueue().getJobCounts("waiting", "active", "completed", "failed", "delayed"),
      getContentQueue().getJobCounts("waiting", "active", "completed", "failed", "delayed"),
      getFileQueue().getJobCounts("waiting", "active", "completed", "failed", "delayed"),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        scrape: scrapeCounts,
        content: contentCounts,
        file: fileCounts,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        success: true,
        data: null,
        error: { code: "QUEUE_UNAVAILABLE", message: `Redis/queue not available: ${message}` },
      },
      { status: 200 }
    );
  }
}
