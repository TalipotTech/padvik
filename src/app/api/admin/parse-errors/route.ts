import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { contentPipelineLogs } from "@/db/schema/system";
import { desc, eq, and, sql, inArray } from "drizzle-orm";

// ---------------------------------------------------------------------------
// GET /api/admin/parse-errors — List parse failures and recoveries
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Admin access required" } },
      { status: 403 }
    );
  }

  const params = request.nextUrl.searchParams;
  const jobId = params.get("jobId");
  const status = params.get("status"); // "failed" | "recovered" | "all"
  const limit = Math.min(parseInt(params.get("limit") ?? "50"), 200);

  // Build conditions: validation failures + recoveries
  const conditions = [];

  // Pipeline stages that indicate parse issues
  conditions.push(
    inArray(contentPipelineLogs.pipelineStage, ["validation", "validation_recovery"])
  );

  // Filter by status
  if (status === "failed") {
    conditions.push(eq(contentPipelineLogs.status, "failed"));
  } else if (status === "recovered") {
    conditions.push(eq(contentPipelineLogs.status, "recovered"));
  } else if (status === "retried") {
    conditions.push(eq(contentPipelineLogs.status, "retried_success"));
  }
  // "all" = no status filter (shows failed + recovered + retried_success)

  // Filter by job ID
  if (jobId) {
    conditions.push(eq(contentPipelineLogs.entityId, parseInt(jobId)));
  }

  // Filter by job type (join with scrapeJobs)
  const jobTypeParam = params.get("jobType");
  if (jobTypeParam && jobTypeParam !== "all") {
    conditions.push(
      sql`${contentPipelineLogs.entityId} IN (SELECT id FROM scrape_jobs WHERE job_type = ${jobTypeParam})`
    );
  }

  const logs = await db
    .select()
    .from(contentPipelineLogs)
    .where(and(...conditions))
    .orderBy(desc(contentPipelineLogs.createdAt))
    .limit(limit);

  // Calculate stats
  const [stats] = await db
    .select({
      total: sql<number>`count(*)::int`,
      failed: sql<number>`count(*) filter (where ${contentPipelineLogs.status} = 'failed')::int`,
      recovered: sql<number>`count(*) filter (where ${contentPipelineLogs.status} = 'recovered')::int`,
      retried: sql<number>`count(*) filter (where ${contentPipelineLogs.status} = 'retried_success')::int`,
      totalCostUsd: sql<number>`coalesce(sum((${contentPipelineLogs.outputData}->>'costUsd')::numeric), 0)::float`,
    })
    .from(contentPipelineLogs)
    .where(
      inArray(contentPipelineLogs.pipelineStage, ["validation", "validation_recovery"])
    );

  // Extract common error patterns
  const errorPatterns: Record<string, number> = {};
  for (const log of logs) {
    const data = log.outputData as Record<string, unknown> | null;
    const error = (data?.error ?? data?.originalError ?? log.errorMessage ?? "") as string;
    // Extract the key part of the error (first line, up to 80 chars)
    const pattern = error.split("\n")[0].slice(0, 80).trim();
    if (pattern) {
      errorPatterns[pattern] = (errorPatterns[pattern] ?? 0) + 1;
    }
  }

  // Sort patterns by frequency
  const topErrors = Object.entries(errorPatterns)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([pattern, count]) => ({ pattern, count }));

  return NextResponse.json({
    success: true,
    data: {
      logs: logs.map((log) => {
        const data = (log.outputData ?? {}) as Record<string, unknown>;
        return {
          id: log.id,
          stage: log.pipelineStage,
          status: log.status,
          jobId: log.entityId,
          filename: data.filename ?? null,
          url: data.url ?? null,
          model: log.aiModelUsed ?? data.model ?? null,
          error: data.error ?? data.originalError ?? log.errorMessage ?? null,
          recoveryError: data.recoveryError ?? null,
          rawResponsePreview: data.rawResponsePreview ?? null,
          recoveredQuestions: data.recoveredQuestions ?? null,
          droppedQuestions: data.droppedQuestions ?? null,
          totalRawQuestions: data.totalRawQuestions ?? null,
          costUsd: data.costUsd ?? null,
          tokens: log.aiTokensUsed,
          processingTimeMs: log.processingTimeMs,
          createdAt: log.createdAt,
          // Retry result fields
          retryQuestionsInserted: (data.retryResult as Record<string, unknown>)?.questionsInserted ?? null,
          retryModel: (data.retryResult as Record<string, unknown>)?.model ?? null,
          retryCostUsd: (data.retryResult as Record<string, unknown>)?.costUsd ?? null,
          retriedAt: (data.retryResult as Record<string, unknown>)?.retriedAt ?? data.retriedAt ?? null,
          retryError: data.retryError ?? null,
        };
      }),
      stats: {
        total: stats?.total ?? 0,
        failed: stats?.failed ?? 0,
        recovered: stats?.recovered ?? 0,
        recoveryRate:
          (stats?.total ?? 0) > 0
            ? Math.round(((stats?.recovered ?? 0) / (stats?.total ?? 0)) * 100)
            : 0,
        wastedCostUsd: stats?.totalCostUsd ?? 0,
      },
      topErrors,
    },
  });
}
