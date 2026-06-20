/**
 * GET /api/admin/auto-content/topic-jobs?topicIds=1,2,3
 *
 * Returns existing auto-content jobs for the given topics, so the dashboard's
 * "Generate for any topic" search can flag content types that already exist.
 */
import { NextRequest, NextResponse } from "next/server";
import { inArray } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { autoContentJobs } from "@/db/schema/auto-content";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Admin access required" } },
      { status: 403 }
    );
  }

  const raw = request.nextUrl.searchParams.get("topicIds") ?? "";
  const topicIds = raw
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);

  if (topicIds.length === 0) {
    return NextResponse.json({ success: true, data: {} });
  }

  try {
    const rows = await db
      .select({
        topicId: autoContentJobs.topicId,
        contentType: autoContentJobs.contentType,
        status: autoContentJobs.status,
        model: autoContentJobs.generationModel,
        requestedModel: autoContentJobs.requestedModel,
      })
      .from(autoContentJobs)
      .where(inArray(autoContentJobs.topicId, topicIds));

    // Group by topicId
    const byTopic: Record<
      number,
      { contentType: string; status: string; model: string | null; requestedModel: string }[]
    > = {};
    for (const r of rows) {
      (byTopic[r.topicId] ??= []).push({
        contentType: r.contentType,
        status: r.status,
        model: r.model,
        requestedModel: r.requestedModel,
      });
    }

    return NextResponse.json({ success: true, data: byTopic });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: { code: "QUERY_ERROR", message } },
      { status: 500 }
    );
  }
}
