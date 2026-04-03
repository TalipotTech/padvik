import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { contentPipelineLogs } from "@/db/schema/system";
import { sql, desc, gte } from "drizzle-orm";

/**
 * GET /api/admin/ai-usage — AI usage stats from contentPipelineLogs
 * Optional query: ?since=2026-04-01 to filter by date
 */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Admin access required" } },
      { status: 403 }
    );
  }

  const sinceParam = request.nextUrl.searchParams.get("since");
  const sinceDate = sinceParam ? new Date(sinceParam) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // Default: last 30 days

  try {
    // Total aggregated stats
    const [totals] = await db
      .select({
        totalCalls: sql<number>`count(*)::int`,
        totalTokens: sql<number>`coalesce(sum(${contentPipelineLogs.aiTokensUsed}), 0)::int`,
        totalProcessingMs: sql<number>`coalesce(sum(${contentPipelineLogs.processingTimeMs}), 0)::int`,
      })
      .from(contentPipelineLogs)
      .where(gte(contentPipelineLogs.createdAt, sinceDate));

    // Per-model breakdown
    const byModel = await db
      .select({
        model: contentPipelineLogs.aiModelUsed,
        callCount: sql<number>`count(*)::int`,
        totalTokens: sql<number>`coalesce(sum(${contentPipelineLogs.aiTokensUsed}), 0)::int`,
        avgTokens: sql<number>`coalesce(avg(${contentPipelineLogs.aiTokensUsed}), 0)::int`,
        totalProcessingMs: sql<number>`coalesce(sum(${contentPipelineLogs.processingTimeMs}), 0)::int`,
      })
      .from(contentPipelineLogs)
      .where(gte(contentPipelineLogs.createdAt, sinceDate))
      .groupBy(contentPipelineLogs.aiModelUsed)
      .orderBy(sql`count(*) desc`);

    // Per-stage breakdown
    const byStage = await db
      .select({
        stage: contentPipelineLogs.pipelineStage,
        callCount: sql<number>`count(*)::int`,
        totalTokens: sql<number>`coalesce(sum(${contentPipelineLogs.aiTokensUsed}), 0)::int`,
        successCount: sql<number>`count(*) filter (where ${contentPipelineLogs.status} = 'completed')::int`,
        failureCount: sql<number>`count(*) filter (where ${contentPipelineLogs.status} = 'failed')::int`,
      })
      .from(contentPipelineLogs)
      .where(gte(contentPipelineLogs.createdAt, sinceDate))
      .groupBy(contentPipelineLogs.pipelineStage)
      .orderBy(sql`count(*) desc`);

    // Recent activity (last 20 entries)
    const recentActivity = await db
      .select({
        id: contentPipelineLogs.id,
        pipelineStage: contentPipelineLogs.pipelineStage,
        entityType: contentPipelineLogs.entityType,
        entityId: contentPipelineLogs.entityId,
        status: contentPipelineLogs.status,
        aiModelUsed: contentPipelineLogs.aiModelUsed,
        aiTokensUsed: contentPipelineLogs.aiTokensUsed,
        processingTimeMs: contentPipelineLogs.processingTimeMs,
        errorMessage: contentPipelineLogs.errorMessage,
        outputData: contentPipelineLogs.outputData,
        createdAt: contentPipelineLogs.createdAt,
      })
      .from(contentPipelineLogs)
      .where(gte(contentPipelineLogs.createdAt, sinceDate))
      .orderBy(desc(contentPipelineLogs.createdAt))
      .limit(20);

    return NextResponse.json({
      success: true,
      data: {
        totals: {
          calls: totals?.totalCalls ?? 0,
          tokens: totals?.totalTokens ?? 0,
          processingMs: totals?.totalProcessingMs ?? 0,
        },
        byModel: byModel.filter((m) => m.model !== null),
        byStage,
        recentActivity,
        since: sinceDate.toISOString(),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: { code: "QUERY_ERROR", message } },
      { status: 500 }
    );
  }
}
