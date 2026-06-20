/**
 * Demand tracker — records student-behaviour signals and aggregates them
 * into per-topic demand scores that drive the auto-content generation queue.
 *
 * Other parts of the app call trackDemandSignal() when relevant events happen
 * (a search with no results, an unanswered doubt, a weak exam topic, …).
 * The scheduler calls calculateDemandScores()/getTopDemandTopics() to decide
 * what content to generate next.
 */

import { db } from "@/db";
import { contentDemandSignals } from "@/db/schema/auto-content";
import { creatorContent } from "@/db/schema/creators";
import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import type { DemandSignalType, ContentGenerationType, DemandScore } from "./types";

// ---------------------------------------------------------------------------
// Default weights per signal type (higher = stronger demand signal)
// ---------------------------------------------------------------------------
export const DEFAULT_SIGNAL_WEIGHTS: Record<DemandSignalType, number> = {
  search: 2.0, // searched for a topic with no/little content
  view: 0.5, // viewed a topic page
  ask_ai: 1.5, // asked AI about this topic
  explainer_stuck: 3.0, // tapped "explain more" 3+ times
  exam_weak: 2.5, // exam results flagged this as a weak topic
  doubt_posted: 2.0, // posted a doubt on a topic with no creator content
  direct_request: 5.0, // explicitly requested content
};

/** Window (days) over which signals contribute to a demand score. */
const SCORING_WINDOW_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Record a single demand signal. Lightweight — one INSERT, no processing.
 *
 * @param topicId    Topic the signal is about.
 * @param signalType One of the DemandSignalType values.
 * @param studentId  The student who triggered it (optional — anonymous allowed).
 * @param weight     Override weight; defaults to DEFAULT_SIGNAL_WEIGHTS[signalType].
 */
export async function trackDemandSignal(
  topicId: number,
  signalType: DemandSignalType,
  studentId?: number,
  weight?: number
): Promise<void> {
  const resolvedWeight = weight ?? DEFAULT_SIGNAL_WEIGHTS[signalType] ?? 1.0;

  await db.insert(contentDemandSignals).values({
    topicId,
    signalType,
    studentId: studentId ?? null,
    // decimal columns are passed as strings in Drizzle
    weight: resolvedWeight.toFixed(1),
  });
}

/**
 * Aggregate the last SCORING_WINDOW_DAYS of signals into per-topic scores.
 *
 * demand_score = SUM(weight) × LN(COUNT(DISTINCT student_id) + 1)
 *
 * The LN factor rewards breadth of demand (many distinct students) on top of
 * raw signal volume, so a topic many students struggle with outranks one a
 * single student hammered repeatedly.
 */
export async function calculateDemandScores(): Promise<DemandScore[]> {
  const since = new Date(Date.now() - SCORING_WINDOW_DAYS * DAY_MS);

  // Per-topic aggregates
  const aggregates = await db
    .select({
      topicId: contentDemandSignals.topicId,
      sumWeight: sql<string>`COALESCE(SUM(${contentDemandSignals.weight}), 0)`,
      uniqueStudents: sql<string>`COUNT(DISTINCT ${contentDemandSignals.studentId})`,
      totalSignals: sql<string>`COUNT(*)`,
    })
    .from(contentDemandSignals)
    .where(gte(contentDemandSignals.createdAt, since))
    .groupBy(contentDemandSignals.topicId);

  if (aggregates.length === 0) return [];

  // Per-topic, per-signal-type counts for the breakdown
  const breakdownRows = await db
    .select({
      topicId: contentDemandSignals.topicId,
      signalType: contentDemandSignals.signalType,
      count: sql<string>`COUNT(*)`,
    })
    .from(contentDemandSignals)
    .where(gte(contentDemandSignals.createdAt, since))
    .groupBy(contentDemandSignals.topicId, contentDemandSignals.signalType);

  const breakdownByTopic = new Map<number, Partial<Record<DemandSignalType, number>>>();
  for (const row of breakdownRows) {
    const map = breakdownByTopic.get(row.topicId) ?? {};
    map[row.signalType as DemandSignalType] = Number(row.count);
    breakdownByTopic.set(row.topicId, map);
  }

  return aggregates.map((row) => {
    const sumWeight = Number(row.sumWeight);
    const uniqueStudents = Number(row.uniqueStudents);
    const totalSignals = Number(row.totalSignals);
    return {
      topicId: row.topicId,
      score: sumWeight * Math.log(uniqueStudents + 1),
      uniqueStudents,
      totalSignals,
      breakdown: breakdownByTopic.get(row.topicId) ?? {},
    } satisfies DemandScore;
  });
}

/**
 * Resolve the "Padvik Official" system creator id from the environment.
 * Throws if unconfigured — the seed script (scripts/seed-system-creator.ts)
 * prints the value to set.
 */
function getSystemCreatorId(): number {
  const raw = process.env.PADVIK_SYSTEM_CREATOR_ID;
  const id = raw ? Number(raw) : NaN;
  if (!raw || Number.isNaN(id)) {
    throw new Error(
      "PADVIK_SYSTEM_CREATOR_ID not configured — run `pnpm db:seed:system-creator` and set it in .env.local"
    );
  }
  return id;
}

/**
 * Top topics that need content: highest demand first, excluding topics that
 * already have published Padvik content.
 *
 * Demand is tracked per-topic (not per content-type), so a topic is considered
 * "covered" once Padvik has any published content for it.
 *
 * @param limit    Max topics to return.
 * @param minScore Drop topics below this demand score.
 * @param contentType Optional — when set, only excludes topics that already
 *                    have published Padvik content of this specific type.
 */
export async function getTopDemandTopics(
  limit = 20,
  minScore = 5.0,
  contentType?: ContentGenerationType
): Promise<DemandScore[]> {
  const scores = await calculateDemandScores();

  const candidates = scores
    .filter((s) => s.score >= minScore)
    .sort((a, b) => b.score - a.score);

  if (candidates.length === 0) return [];

  const systemCreatorId = getSystemCreatorId();

  // Which candidate topics already have published Padvik content?
  const topicIds = candidates.map((c) => c.topicId);
  const covered = await db
    .select({ topicId: creatorContent.topicId })
    .from(creatorContent)
    .where(
      and(
        eq(creatorContent.creatorId, systemCreatorId),
        eq(creatorContent.isPublished, true),
        contentType ? eq(creatorContent.contentType, contentType) : undefined,
        inArray(creatorContent.topicId, topicIds)
      )
    );

  const coveredTopicIds = new Set(
    covered.map((c) => c.topicId).filter((id): id is number => id != null)
  );

  return candidates.filter((c) => !coveredTopicIds.has(c.topicId)).slice(0, limit);
}

/**
 * Delete signals older than `daysToKeep`. Returns the number of rows deleted.
 */
export async function cleanupOldSignals(daysToKeep = 90): Promise<number> {
  const cutoff = new Date(Date.now() - daysToKeep * DAY_MS);
  const deleted = await db
    .delete(contentDemandSignals)
    .where(lt(contentDemandSignals.createdAt, cutoff))
    .returning({ id: contentDemandSignals.id });
  return deleted.length;
}
