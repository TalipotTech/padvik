/**
 * GET /api/admin/pipeline/cleanup
 *
 * Marks stale processing content (>30 minutes) as failed.
 * Can be called manually, via cron, or as a periodic health check.
 */

import { NextResponse } from "next/server";
import { markStaleProcessingAsFailed } from "@/lib/content-pipeline/stale-checker";

export async function GET() {
  try {
    const count = await markStaleProcessingAsFailed();
    return NextResponse.json({
      success: true,
      data: {
        markedAsFailed: count,
        checkedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "CLEANUP_ERROR",
          message: err instanceof Error ? err.message : "Cleanup failed",
        },
      },
      { status: 500 }
    );
  }
}
