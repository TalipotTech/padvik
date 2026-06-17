/**
 * Bulk-generate explainer decks for topics that don't yet have one at the
 * requested level. Runs inline (admin UI invokes this through an API route)
 * with a rate limiter so AI cost is predictable.
 *
 * This is kept separate from the BullMQ scrape/content queues so it doesn't
 * interfere with existing pipelines — it's a self-contained extension.
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { topics, chapters, subjects, standards } from "@/db/schema/curriculum";
import { topicExplainerDecks } from "@/db/schema/explainers";
import { generateTopicDeck } from "./generate-deck";

export interface BulkGenerateOptions {
  boardId?: number;
  subjectId?: number;
  standardId?: number;
  grade?: number;
  level?: 1 | 2 | 3;
  language?: string;
  limit?: number;
  /** Seconds between AI calls — protects the Anthropic rate limit. */
  rateLimitMs?: number;
  onProgress?: (progress: {
    processed: number;
    total: number;
    topicId: number;
    status: "ok" | "failed";
    error?: string;
  }) => void;
}

export interface BulkGenerateResult {
  generated: number;
  failed: number;
  totalCostUsd: number;
  failures: Array<{ topicId: number; error: string }>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function bulkGenerateDecks(
  options: BulkGenerateOptions = {}
): Promise<BulkGenerateResult> {
  const {
    boardId,
    subjectId,
    standardId,
    grade,
    level = 2,
    language = "en",
    limit = 25,
    rateLimitMs = 5000,
    onProgress,
  } = options;

  // Find topics that don't yet have a deck at this (level, language).
  // We join up to standards so we can filter by board/grade if asked.
  const whereConds: ReturnType<typeof sql>[] = [];
  if (boardId != null) whereConds.push(sql`${standards.boardId} = ${boardId}`);
  if (subjectId != null) whereConds.push(sql`${subjects.id} = ${subjectId}`);
  if (standardId != null) whereConds.push(sql`${standards.id} = ${standardId}`);
  if (grade != null) whereConds.push(sql`${standards.grade} = ${grade}`);
  // Deck-missing predicate
  whereConds.push(sql`NOT EXISTS (
    SELECT 1 FROM ${topicExplainerDecks} d
    WHERE d.topic_id = ${topics.id}
      AND d.level = ${level}
      AND d.language = ${language}
  )`);

  const rows = await db
    .select({ topicId: topics.id })
    .from(topics)
    .leftJoin(chapters, eq(chapters.id, topics.chapterId))
    .leftJoin(subjects, eq(subjects.id, chapters.subjectId))
    .leftJoin(standards, eq(standards.id, subjects.standardId))
    .where(whereConds.length ? and(...whereConds) : undefined)
    .limit(limit);

  const result: BulkGenerateResult = {
    generated: 0,
    failed: 0,
    totalCostUsd: 0,
    failures: [],
  };

  for (let i = 0; i < rows.length; i++) {
    const topicId = Number(rows[i].topicId);
    try {
      const gen = await generateTopicDeck(topicId, level, language);
      result.generated += 1;
      result.totalCostUsd += gen.costUsd;
      onProgress?.({
        processed: i + 1,
        total: rows.length,
        topicId,
        status: "ok",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.failed += 1;
      result.failures.push({ topicId, error: message });
      onProgress?.({
        processed: i + 1,
        total: rows.length,
        topicId,
        status: "failed",
        error: message,
      });
    }

    if (i < rows.length - 1 && rateLimitMs > 0) {
      await sleep(rateLimitMs);
    }
  }

  return result;
}
