/**
 * GET /api/admin/auto-content/costs — cost analytics for the auto-content pipeline.
 *
 * Query: ?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD (defaults to the last 30 days)
 */
import { NextRequest, NextResponse } from "next/server";
import { and, gte, lte, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { autoContentJobs } from "@/db/schema/auto-content";
import { reportError } from "@/lib/observability/sentry";

/** Derive a provider name from a model id (mirrors the AI provider router). */
function providerFromModel(model: string | null): string {
  if (!model) return "unknown";
  if (model.startsWith("claude-")) return "anthropic";
  if (model.startsWith("gemini-") || model.startsWith("gemma-")) return "gemini";
  if (
    model.startsWith("mistral-") ||
    model.startsWith("open-mistral") ||
    model.startsWith("codestral")
  )
    return "mistral";
  if (model.startsWith("sonar") || model.startsWith("pplx-")) return "perplexity";
  if (model.startsWith("gpt-")) return "openai";
  return "unknown";
}

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Admin access required" } },
      { status: 403 }
    );
  }

  try {
    const sp = request.nextUrl.searchParams;
    const startParam = sp.get("startDate");
    const endParam = sp.get("endDate");

    const startDate = startParam
      ? new Date(startParam)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const endDate = endParam ? new Date(endParam) : new Date();
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      return NextResponse.json(
        { success: false, error: { code: "BAD_DATE", message: "Invalid startDate/endDate" } },
        { status: 400 }
      );
    }
    // Include the whole end day
    endDate.setHours(23, 59, 59, 999);

    const rangeWhere = and(
      gte(autoContentJobs.createdAt, startDate),
      lte(autoContentJobs.createdAt, endDate)
    );

    // ---- totalCost ----
    const [totals] = await db
      .select({ total: sql<string>`COALESCE(SUM(${autoContentJobs.generationCostUsd}), 0)` })
      .from(autoContentJobs)
      .where(rangeWhere);

    // ---- byDay ----
    const day = sql<string>`TO_CHAR(${autoContentJobs.createdAt}, 'YYYY-MM-DD')`;
    const byDayRows = await db
      .select({
        date: day,
        cost: sql<string>`COALESCE(SUM(${autoContentJobs.generationCostUsd}), 0)`,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(autoContentJobs)
      .where(rangeWhere)
      .groupBy(day)
      .orderBy(day);

    // ---- byType ----
    const byTypeRows = await db
      .select({
        contentType: autoContentJobs.contentType,
        cost: sql<string>`COALESCE(SUM(${autoContentJobs.generationCostUsd}), 0)`,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(autoContentJobs)
      .where(rangeWhere)
      .groupBy(autoContentJobs.contentType);

    // ---- byProvider (derived from model) ----
    const byModelRows = await db
      .select({
        model: autoContentJobs.generationModel,
        cost: sql<string>`COALESCE(SUM(${autoContentJobs.generationCostUsd}), 0)`,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(autoContentJobs)
      .where(rangeWhere)
      .groupBy(autoContentJobs.generationModel);

    const providerMap = new Map<string, { provider: string; cost: number; count: number }>();
    for (const r of byModelRows) {
      const provider = providerFromModel(r.model);
      const entry = providerMap.get(provider) ?? { provider, cost: 0, count: 0 };
      entry.cost += Number(r.cost);
      entry.count += r.count;
      providerMap.set(provider, entry);
    }

    // ---- averageCostPerItem (per type) ----
    const avgRows = await db
      .select({
        contentType: autoContentJobs.contentType,
        avg: sql<string>`COALESCE(AVG(${autoContentJobs.generationCostUsd}), 0)`,
      })
      .from(autoContentJobs)
      .where(rangeWhere)
      .groupBy(autoContentJobs.contentType);

    const avgByType: Record<string, number> = {};
    for (const r of avgRows) avgByType[r.contentType] = Number(r.avg);

    return NextResponse.json({
      success: true,
      data: {
        totalCost: Number(totals?.total ?? 0),
        byDay: byDayRows.map((r) => ({ date: r.date, cost: Number(r.cost), count: r.count })),
        byType: byTypeRows.map((r) => ({
          contentType: r.contentType,
          cost: Number(r.cost),
          count: r.count,
        })),
        byProvider: Array.from(providerMap.values()),
        averageCostPerItem: {
          text_note: avgByType.text_note ?? 0,
          audio_explainer: avgByType.audio_explainer ?? 0,
          question_set: avgByType.question_set ?? 0,
        },
        range: { startDate: startDate.toISOString(), endDate: endDate.toISOString() },
      },
    });
  } catch (err) {
    reportError(err, { where: "api:auto-content:costs" });
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: { code: "QUERY_ERROR", message } },
      { status: 500 }
    );
  }
}
