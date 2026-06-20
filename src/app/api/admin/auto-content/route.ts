/**
 * GET /api/admin/auto-content — admin dashboard data for the auto-content pipeline.
 *
 * Returns today's stats, the top demand topics, recent jobs, and a 7-day
 * budget-spend history.
 */
import { NextResponse } from "next/server";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { autoContentJobs } from "@/db/schema/auto-content";
import { creatorContent } from "@/db/schema/creators";
import { topics, chapters, subjects, standards, boards } from "@/db/schema/curriculum";
import { calculateDemandScores, getDailyBudgetStatus } from "@/lib/auto-content";
import { reportError } from "@/lib/observability/sentry";

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function systemCreatorId(): number | null {
  const raw = process.env.PADVIK_SYSTEM_CREATOR_ID;
  const id = raw ? Number(raw) : NaN;
  return raw && !Number.isNaN(id) ? id : null;
}

/** Derive a provider name from a model id (mirrors the AI router). */
function providerFromModel(model: string | null): string {
  if (!model) return "—";
  if (model.startsWith("youtube")) return "youtube";
  if (model.startsWith("claude-")) return "anthropic";
  if (model.startsWith("gemini-") || model.startsWith("gemma-")) return "gemini";
  if (model.startsWith("mistral-") || model.startsWith("open-mistral") || model.startsWith("codestral"))
    return "mistral";
  if (model.startsWith("sonar") || model.startsWith("pplx-")) return "perplexity";
  if (model.startsWith("gpt-")) return "openai";
  return "other";
}

export async function GET() {
  const session = await auth();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Admin access required" } },
      { status: 403 }
    );
  }

  try {
    const today = startOfToday();

    // ---- todayStats ----
    const statusRows = await db
      .select({
        status: autoContentJobs.status,
        count: sql<number>`COUNT(*)::int`,
        withContent: sql<number>`COUNT(${autoContentJobs.contentId})::int`,
      })
      .from(autoContentJobs)
      .where(gte(autoContentJobs.createdAt, today))
      .groupBy(autoContentJobs.status);

    let published = 0;
    let failed = 0;
    let pending = 0;
    let generated = 0;
    for (const r of statusRows) {
      generated += r.withContent;
      if (r.status === "published") published += r.count;
      else if (r.status === "failed") failed += r.count;
      else if (["queued", "generating", "reviewing"].includes(r.status)) pending += r.count;
    }

    const budget = await getDailyBudgetStatus();

    const todayStats = {
      generated,
      pending,
      published,
      failed,
      costUsd: Number(budget.spentUsd.toFixed(4)),
      budgetRemaining: Number(budget.remainingUsd.toFixed(4)),
      budgetLimit: Number(budget.budgetUsd.toFixed(4)),
    };

    // ---- all-time totals for the Padvik system creator ----
    const creatorIdForTotals = systemCreatorId();
    let totals = { published: 0, topicsWithContent: 0 };
    if (creatorIdForTotals) {
      const [t] = await db
        .select({
          published: sql<number>`COUNT(*) FILTER (WHERE ${creatorContent.isPublished})::int`,
          topicsWithContent: sql<number>`COUNT(DISTINCT ${creatorContent.topicId}) FILTER (WHERE ${creatorContent.isPublished})::int`,
        })
        .from(creatorContent)
        .where(eq(creatorContent.creatorId, creatorIdForTotals));
      totals = {
        published: t?.published ?? 0,
        topicsWithContent: t?.topicsWithContent ?? 0,
      };
    }

    // ---- topDemandTopics (top 20 by demand score) ----
    const scores = (await calculateDemandScores())
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);
    const topicIds = scores.map((s) => s.topicId);

    const ctxRows = topicIds.length
      ? await db
          .select({
            topicId: topics.id,
            topicName: topics.title,
            chapter: chapters.title,
            subject: subjects.name,
            board: boards.code,
            klass: standards.grade,
          })
          .from(topics)
          .innerJoin(chapters, eq(chapters.id, topics.chapterId))
          .innerJoin(subjects, eq(subjects.id, chapters.subjectId))
          .innerJoin(standards, eq(standards.id, subjects.standardId))
          .innerJoin(boards, eq(boards.id, standards.boardId))
          .where(inArray(topics.id, topicIds))
      : [];
    const ctxById = new Map(ctxRows.map((r) => [r.topicId, r]));

    // Which of these topics already have Padvik content?
    const creatorId = systemCreatorId();
    const coveredIds = new Set<number>();
    if (creatorId && topicIds.length) {
      const covered = await db
        .select({ topicId: creatorContent.topicId })
        .from(creatorContent)
        .where(
          and(
            eq(creatorContent.creatorId, creatorId),
            inArray(creatorContent.topicId, topicIds)
          )
        );
      for (const c of covered) if (c.topicId != null) coveredIds.add(c.topicId);
    }

    const topDemandTopics = scores.map((s) => {
      const ctx = ctxById.get(s.topicId);
      return {
        topicId: s.topicId,
        topicName: ctx?.topicName ?? null,
        chapter: ctx?.chapter ?? null,
        subject: ctx?.subject ?? null,
        board: ctx?.board ?? null,
        class: ctx?.klass ?? null,
        demandScore: Number(s.score.toFixed(2)),
        uniqueStudents: s.uniqueStudents,
        hasExistingContent: coveredIds.has(s.topicId),
        signalBreakdown: s.breakdown,
      };
    });

    // ---- recentJobs (last 20) ----
    // Join the linked content so we can flag audio jobs that published with no
    // media file (transcript-only fallback).
    const recentJobs = await db
      .select({
        id: autoContentJobs.id,
        status: autoContentJobs.status,
        contentType: autoContentJobs.contentType,
        topicId: autoContentJobs.topicId,
        topicName: topics.title,
        chapter: chapters.title,
        subject: subjects.name,
        class: standards.grade,
        board: boards.code,
        requestedModel: autoContentJobs.requestedModel,
        model: autoContentJobs.generationModel,
        costUsd: autoContentJobs.generationCostUsd,
        createdAt: autoContentJobs.createdAt,
        contentId: autoContentJobs.contentId,
        mediaUrl: creatorContent.mediaUrl,
        lastError: autoContentJobs.lastError,
      })
      .from(autoContentJobs)
      .leftJoin(topics, eq(topics.id, autoContentJobs.topicId))
      .leftJoin(chapters, eq(chapters.id, topics.chapterId))
      .leftJoin(subjects, eq(subjects.id, chapters.subjectId))
      .leftJoin(standards, eq(standards.id, subjects.standardId))
      .leftJoin(boards, eq(boards.id, standards.boardId))
      .leftJoin(creatorContent, eq(creatorContent.id, autoContentJobs.contentId))
      .orderBy(desc(autoContentJobs.createdAt))
      .limit(20);

    // ---- cost & usage by model (last 7 days) ----
    const sevenDaysAgoModels = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    sevenDaysAgoModels.setHours(0, 0, 0, 0);
    const costByModelRows = await db
      .select({
        model: autoContentJobs.generationModel,
        cost: sql<string>`COALESCE(SUM(${autoContentJobs.generationCostUsd}), 0)`,
        count: sql<number>`COUNT(*) FILTER (WHERE ${autoContentJobs.generationModel} IS NOT NULL)::int`,
      })
      .from(autoContentJobs)
      .where(gte(autoContentJobs.createdAt, sevenDaysAgoModels))
      .groupBy(autoContentJobs.generationModel);

    // ---- budgetHistory (last 7 days) ----
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    sevenDaysAgo.setHours(0, 0, 0, 0);
    const day = sql<string>`TO_CHAR(${autoContentJobs.createdAt}, 'YYYY-MM-DD')`;
    const budgetHistory = await db
      .select({
        date: day,
        cost: sql<string>`COALESCE(SUM(${autoContentJobs.generationCostUsd}), 0)`,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(autoContentJobs)
      .where(gte(autoContentJobs.createdAt, sevenDaysAgo))
      .groupBy(day)
      .orderBy(day);

    return NextResponse.json({
      success: true,
      data: {
        todayStats,
        totals,
        topDemandTopics,
        recentJobs: recentJobs.map(({ mediaUrl, contentId, ...j }) => ({
          ...j,
          costUsd: j.costUsd != null ? Number(j.costUsd) : null,
          provider: providerFromModel(j.model),
          // Audio job that produced content but no media file = transcript-only.
          audioPending:
            j.contentType === "audio_explainer" && contentId != null && !mediaUrl,
        })),
        budgetHistory: budgetHistory.map((b) => ({
          date: b.date,
          cost: Number(b.cost),
          count: b.count,
        })),
        costByModel: costByModelRows
          .filter((r) => r.model)
          .map((r) => ({
            model: r.model as string,
            provider: providerFromModel(r.model),
            cost: Number(r.cost),
            count: r.count,
          }))
          .sort((a, b) => b.cost - a.cost),
      },
    });
  } catch (err) {
    reportError(err, { where: "api:auto-content:dashboard" });
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: { code: "QUERY_ERROR", message } },
      { status: 500 }
    );
  }
}
