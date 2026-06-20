/**
 * Auto-content orchestrator — the brain that decides WHAT to generate and WHEN.
 *
 * Runs on a schedule (see jobs.ts):
 *   - picks the highest-demand topics that lack Padvik content
 *   - queues the right content types (text note / question set / audio) per topic
 *   - processes each queued job through its generator + publisher
 *   - respects a daily USD budget and per-type daily caps
 */
import { db } from "@/db";
import { autoContentJobs } from "@/db/schema/auto-content";
import { creatorContent } from "@/db/schema/creators";
import { boards, standards, subjects, chapters, topics } from "@/db/schema/curriculum";
import { and, eq, gte, ne, sql } from "drizzle-orm";
import { getTopDemandTopics } from "./demand-tracker";
import { generateTextNote } from "./generators/text-note";
import { generateQuestionSet } from "./generators/question-set";
import { generateAudioExplainer } from "./generators/audio-explainer";
import { generateVideoLesson } from "./generators/video-lesson";
import { publishAutoContent, shouldAutoApprove } from "./publisher";
import { isAuthError } from "@/lib/ai/provider";
import { reportError } from "@/lib/observability/sentry";
import type { ContentBudgetStatus, ContentGenerationType } from "./types";

/**
 * Marks a failure that must NOT be retried — auth/credit/validation errors
 * won't fix themselves by re-running, so retrying just wastes time and money.
 * The BullMQ worker converts this into an UnrecoverableError.
 */
export class TerminalGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TerminalGenerationError";
  }
}

/** True for errors where a retry is pointless (auth, billing/credits, bad request). */
function isTerminalError(err: unknown): boolean {
  if (isAuthError(err)) return true; // 401/403, "api key", "authentication", …
  const status =
    (err as { status?: number }).status ?? (err as { statusCode?: number }).statusCode;
  if (status === 400 || status === 402) return true; // bad request / payment required
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return /credit|insufficient|billing|payment|invalid_request|validation error/.test(msg);
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const DEFAULT_DAILY_BUDGET_USD = 5.0;

/** Per-type caps so a demand spike can't flood the catalogue in one day. */
const DAILY_LIMITS: Record<
  "text_note" | "audio_explainer" | "question_set" | "video_lesson",
  number
> = {
  text_note: 15,
  audio_explainer: 5,
  question_set: 5,
  video_lesson: 3,
};

/** demand_score is decimal(5,2) — clamp before persisting to avoid overflow. */
const MAX_DEMAND_SCORE = 999.99;

const MAX_ATTEMPTS = 3;

// Demand thresholds that unlock heavier content types
const AUDIO_DEMAND_THRESHOLD = 50;
const VIDEO_DEMAND_THRESHOLD = 100;

// creator_content.content_type values produced by this pipeline
const CC_NOTE = "note";
const CC_AUDIO = "audio";
const CC_VIDEO = "video";

function getDailyBudgetLimit(): number {
  const parsed = parseFloat(process.env.DAILY_CONTENT_BUDGET ?? "");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_DAILY_BUDGET_USD;
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function getSystemCreatorId(): number {
  const raw = process.env.PADVIK_SYSTEM_CREATOR_ID;
  const id = raw ? Number(raw) : NaN;
  if (!raw || Number.isNaN(id)) {
    throw new Error("PADVIK_SYSTEM_CREATOR_ID not configured");
  }
  return id;
}

// ---------------------------------------------------------------------------
// 1. Budget
// ---------------------------------------------------------------------------
/**
 * Today's spend across all non-failed auto-content jobs vs the configured cap.
 */
export async function getDailyBudgetStatus(): Promise<ContentBudgetStatus> {
  const since = startOfToday();
  const [row] = await db
    .select({
      spent: sql<string>`COALESCE(SUM(${autoContentJobs.generationCostUsd}), 0)`,
      jobs: sql<string>`COUNT(*)`,
    })
    .from(autoContentJobs)
    .where(and(gte(autoContentJobs.createdAt, since), ne(autoContentJobs.status, "failed")));

  const budgetUsd = getDailyBudgetLimit();
  const spentUsd = Number(row?.spent ?? 0);
  const jobsRun = Number(row?.jobs ?? 0);

  return {
    date: since.toISOString().slice(0, 10),
    budgetUsd,
    spentUsd,
    remainingUsd: Math.max(0, budgetUsd - spentUsd),
    jobsRun,
    isExhausted: spentUsd >= budgetUsd,
  };
}

// ---------------------------------------------------------------------------
// Topic context
// ---------------------------------------------------------------------------
interface TopicContext {
  topicId: number;
  topicName: string;
  chapterId: number;
  chapter: string;
  subjectId: number;
  subject: string;
  standardId: number;
  standard: number;
  boardId: number;
  boardCode: string;
}

async function getTopicContext(topicId: number): Promise<TopicContext | null> {
  const [row] = await db
    .select({
      topicId: topics.id,
      topicName: topics.title,
      chapterId: chapters.id,
      chapter: chapters.title,
      subjectId: subjects.id,
      subject: subjects.name,
      standardId: standards.id,
      standard: standards.grade,
      boardId: boards.id,
      boardCode: boards.code,
    })
    .from(topics)
    .innerJoin(chapters, eq(chapters.id, topics.chapterId))
    .innerJoin(subjects, eq(subjects.id, chapters.subjectId))
    .innerJoin(standards, eq(standards.id, subjects.standardId))
    .innerJoin(boards, eq(boards.id, standards.boardId))
    .where(eq(topics.id, topicId))
    .limit(1);

  return row ?? null;
}

/** Set of creator_content content_types Padvik already has for this topic. */
async function getPadvikContentTypes(topicId: number, creatorId: number): Promise<Set<string>> {
  const rows = await db
    .select({ contentType: creatorContent.contentType })
    .from(creatorContent)
    .where(and(eq(creatorContent.creatorId, creatorId), eq(creatorContent.topicId, topicId)));
  return new Set(rows.map((r) => r.contentType));
}

/** Set of generation types that already have a job row for this topic. */
async function getExistingJobTypes(topicId: number): Promise<Set<string>> {
  const rows = await db
    .select({ contentType: autoContentJobs.contentType })
    .from(autoContentJobs)
    .where(eq(autoContentJobs.topicId, topicId));
  return new Set(rows.map((r) => r.contentType));
}

/** Count today's jobs grouped by content type (for the per-type daily caps). */
async function getTodayJobCountsByType(): Promise<Record<string, number>> {
  const rows = await db
    .select({
      contentType: autoContentJobs.contentType,
      count: sql<string>`COUNT(*)`,
    })
    .from(autoContentJobs)
    .where(gte(autoContentJobs.createdAt, startOfToday()))
    .groupBy(autoContentJobs.contentType);

  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.contentType] = Number(r.count);
  return counts;
}

/**
 * Insert a queued job for (topic, type). Returns the new job id, or null if a
 * job for this (topic, type) already exists (unique constraint → conflict).
 */
async function queueJob(
  ctx: TopicContext,
  contentType: ContentGenerationType,
  priority: number,
  demandScore: number
): Promise<number | null> {
  const [row] = await db
    .insert(autoContentJobs)
    .values({
      topicId: ctx.topicId,
      boardId: ctx.boardId,
      standardId: ctx.standardId,
      subjectId: ctx.subjectId,
      contentType,
      priority,
      demandScore: Math.min(demandScore, MAX_DEMAND_SCORE).toFixed(2),
      status: "queued",
    })
    .onConflictDoNothing({
      target: [
        autoContentJobs.topicId,
        autoContentJobs.contentType,
        autoContentJobs.requestedModel,
      ],
    })
    .returning({ id: autoContentJobs.id });

  return row?.id ?? null;
}

// ---------------------------------------------------------------------------
// 2. Generation cycle
// ---------------------------------------------------------------------------
export interface ContentCycleResult {
  generated: number;
  failed: number;
  skipped: number;
  costUsd: number;
}

/**
 * Main scheduled entry point: decide what to generate for the top demand
 * topics, queue the jobs, and process them within the daily budget.
 */
export async function runContentGenerationCycle(): Promise<ContentCycleResult> {
  const result: ContentCycleResult = { generated: 0, failed: 0, skipped: 0, costUsd: 0 };

  // a. Feature flag
  if (process.env.AUTO_CONTENT_ENABLED === "false") {
    console.log("[orchestrator] AUTO_CONTENT_ENABLED=false — skipping cycle");
    return result;
  }

  // b. Budget
  const budget = await getDailyBudgetStatus();
  if (budget.isExhausted) {
    console.log(
      `[orchestrator] Daily budget exhausted ($${budget.spentUsd.toFixed(2)}/$${budget.budgetUsd.toFixed(2)}) — skipping cycle`
    );
    return result;
  }

  const systemCreatorId = getSystemCreatorId();

  // c. Top demand topics that lack Padvik content
  const demandTopics = await getTopDemandTopics(10, 5.0);
  if (demandTopics.length === 0) {
    console.log("[orchestrator] No topics above the demand threshold need content");
    return result;
  }

  // Per-type daily counts (today's jobs), incremented locally as we queue
  const localCounts = await getTodayJobCountsByType();
  const countOf = (t: string) => localCounts[t] ?? 0;

  // d. Decide + queue per topic
  const jobIdsToProcess: number[] = [];

  for (const topic of demandTopics) {
    const ctx = await getTopicContext(topic.topicId);
    if (!ctx) {
      console.warn(`[orchestrator] Topic ${topic.topicId} has no curriculum context — skipping`);
      result.skipped++;
      continue;
    }

    const existingContent = await getPadvikContentTypes(topic.topicId, systemCreatorId);
    const existingJobs = await getExistingJobTypes(topic.topicId);

    const hasNote = existingContent.has(CC_NOTE) || existingJobs.has("text_note");
    const hasAudio = existingContent.has(CC_AUDIO) || existingJobs.has("audio_explainer");
    const hasVideo = existingContent.has(CC_VIDEO) || existingJobs.has("video_lesson");
    const hasAnyContent = existingContent.size > 0;
    const hasAnyJob = existingJobs.size > 0;

    const toQueue: { type: ContentGenerationType; priority: number }[] = [];

    if (!hasAnyContent && !hasAnyJob) {
      // Brand new topic — notes first (fast, immediate value), then questions.
      toQueue.push({ type: "text_note", priority: 1 });
      toQueue.push({ type: "question_set", priority: 2 });
    } else if (hasNote && !hasAudio && topic.score > AUDIO_DEMAND_THRESHOLD) {
      // Sustained demand on a topic that already has notes — invest in audio.
      toQueue.push({ type: "audio_explainer", priority: 3 });
    }

    // Video: once notes + audio exist and demand is high, curate a YouTube
    // lesson (always lands in review). Independent of the branches above.
    if (hasNote && hasAudio && !hasVideo && topic.score > VIDEO_DEMAND_THRESHOLD) {
      toQueue.push({ type: "video_lesson", priority: 4 });
    }

    for (const q of toQueue) {
      // Per-type daily cap
      const cap = DAILY_LIMITS[q.type as keyof typeof DAILY_LIMITS];
      if (cap != null && countOf(q.type) >= cap) {
        result.skipped++;
        continue;
      }

      const jobId = await queueJob(ctx, q.type, q.priority, topic.score);
      if (jobId == null) {
        // Already has a job for this (topic, type)
        result.skipped++;
        continue;
      }

      localCounts[q.type] = countOf(q.type) + 1;
      jobIdsToProcess.push(jobId);
    }
  }

  // e. Process queued jobs within budget
  for (const jobId of jobIdsToProcess) {
    const liveBudget = await getDailyBudgetStatus();
    if (liveBudget.isExhausted) {
      console.log("[orchestrator] Daily budget exhausted mid-cycle — stopping");
      result.skipped += 1; // this job stays queued for the next cycle
      continue;
    }

    try {
      await processAutoContentJob(BigInt(jobId));
    } catch {
      // Failure already recorded on the row; tally below reads it back.
    }

    // Tally outcome from the (now-updated) job row
    const [job] = await db
      .select({ status: autoContentJobs.status, cost: autoContentJobs.generationCostUsd })
      .from(autoContentJobs)
      .where(eq(autoContentJobs.id, jobId))
      .limit(1);

    result.costUsd += Number(job?.cost ?? 0);
    if (job?.status === "published" || job?.status === "reviewing") {
      result.generated++;
    } else if (job?.status === "failed") {
      result.failed++;
    } else {
      // still 'queued' (budget revert / will retry)
      result.skipped++;
    }
  }

  console.log(
    `[orchestrator] Cycle done: generated=${result.generated} failed=${result.failed} skipped=${result.skipped} cost=$${result.costUsd.toFixed(2)}`
  );
  return result;
}

// ---------------------------------------------------------------------------
// 3. Process a single job
// ---------------------------------------------------------------------------
/**
 * Run one auto-content job end-to-end: generate → publish, updating the job row.
 * Generation failures are recorded on the job (and re-queued until MAX_ATTEMPTS);
 * this function does not throw on generator failure.
 */
export async function processAutoContentJob(jobId: bigint): Promise<void> {
  const id = Number(jobId);

  // a. Fetch the job
  const [job] = await db
    .select()
    .from(autoContentJobs)
    .where(eq(autoContentJobs.id, id))
    .limit(1);

  if (!job) {
    console.warn(`[orchestrator] Job ${id} not found`);
    return;
  }

  const attemptsNow = (job.attempts ?? 0) + 1;

  // b. Mark generating + increment attempts
  await db
    .update(autoContentJobs)
    .set({ status: "generating", attempts: attemptsNow, updatedAt: new Date() })
    .where(eq(autoContentJobs.id, id));

  // c. Budget guard (other jobs may have used it up)
  const budget = await getDailyBudgetStatus();
  if (budget.isExhausted) {
    console.log(`[orchestrator] Daily budget exhausted — re-queueing job ${id}`);
    await db
      .update(autoContentJobs)
      .set({ status: "queued", updatedAt: new Date() })
      .where(eq(autoContentJobs.id, id));
    return;
  }

  try {
    const ctx = await getTopicContext(job.topicId);
    if (!ctx) {
      throw new Error(`Topic ${job.topicId} has no curriculum context`);
    }

    const contentType = job.contentType as ContentGenerationType;
    // "default" means use the generator's configured model; anything else is an
    // explicit admin-selected model override.
    const modelOverride =
      job.requestedModel && job.requestedModel !== "default"
        ? job.requestedModel
        : undefined;
    const baseParams = {
      topicId: BigInt(ctx.topicId),
      boardCode: ctx.boardCode,
      standard: ctx.standard,
      subject: ctx.subject,
      chapter: ctx.chapter,
      topicName: ctx.topicName,
      modelOverride,
    };

    // d. Generate + publish per type
    if (contentType === "text_note") {
      const out = await generateTextNote(baseParams);
      await recordGenerationMeta(id, out.model, out.costUsd, out.timeMs, { blocks: out.blocks });
      await publishAutoContent({
        jobId: BigInt(id),
        topicId: BigInt(ctx.topicId),
        boardId: BigInt(ctx.boardId),
        standardId: BigInt(ctx.standardId),
        subjectId: BigInt(ctx.subjectId),
        chapterId: BigInt(ctx.chapterId),
        contentType,
        title: out.title,
        blocks: out.blocks,
        model: out.model,
        costUsd: out.costUsd,
        autoApprove: shouldAutoApprove(contentType, out.blocks),
      });
    } else if (contentType === "question_set") {
      const out = await generateQuestionSet(baseParams);
      await recordGenerationMeta(id, out.model, out.costUsd, out.timeMs, {
        questions: out.questions,
      });
      await publishAutoContent({
        jobId: BigInt(id),
        topicId: BigInt(ctx.topicId),
        boardId: BigInt(ctx.boardId),
        standardId: BigInt(ctx.standardId),
        subjectId: BigInt(ctx.subjectId),
        chapterId: BigInt(ctx.chapterId),
        contentType,
        title: `Practice Questions: ${ctx.topicName} — ${ctx.boardCode} Class ${ctx.standard}`,
        questions: out.questions,
        model: out.model,
        costUsd: out.costUsd,
        autoApprove: shouldAutoApprove(contentType, undefined, out.questions),
      });
    } else if (contentType === "audio_explainer") {
      const out = await generateAudioExplainer(baseParams);
      if (out.audioError) {
        console.warn(`[orchestrator] Job ${id} audio unavailable: ${out.audioError}`);
      }
      await recordGenerationMeta(id, out.model, out.costUsd, out.timeMs, {
        transcript: out.transcript,
        durationSecs: out.durationSecs,
        hasAudio: !!out.audioBuffer,
        audioError: out.audioError,
      });
      await publishAutoContent({
        jobId: BigInt(id),
        topicId: BigInt(ctx.topicId),
        boardId: BigInt(ctx.boardId),
        standardId: BigInt(ctx.standardId),
        subjectId: BigInt(ctx.subjectId),
        chapterId: BigInt(ctx.chapterId),
        contentType,
        title: `Audio Lesson: ${ctx.topicName} — ${ctx.boardCode} Class ${ctx.standard}`,
        audioBuffer: out.audioBuffer ?? undefined,
        audioMimeType: out.audioMimeType ?? undefined,
        transcript: out.transcript,
        durationSecs: out.durationSecs,
        model: out.model,
        costUsd: out.costUsd,
        autoApprove: shouldAutoApprove(contentType),
      });
    } else if (contentType === "video_lesson") {
      const out = await generateVideoLesson(baseParams);
      if (out.error || !out.videoUrl) {
        // Missing key / no matching video won't fix on retry — fail fast.
        throw new TerminalGenerationError(out.error ?? "No video URL returned");
      }
      await recordGenerationMeta(id, out.model, out.costUsd, out.timeMs, {
        videoId: out.videoId,
        videoUrl: out.videoUrl,
        channelTitle: out.channelTitle,
        durationSecs: out.durationSecs,
      });
      await publishAutoContent({
        jobId: BigInt(id),
        topicId: BigInt(ctx.topicId),
        boardId: BigInt(ctx.boardId),
        standardId: BigInt(ctx.standardId),
        subjectId: BigInt(ctx.subjectId),
        chapterId: BigInt(ctx.chapterId),
        contentType,
        title: out.title,
        videoUrl: out.videoUrl,
        thumbnailUrl: out.thumbnailUrl ?? undefined,
        videoChannel: out.channelTitle ?? undefined,
        durationSecs: out.durationSecs ?? undefined,
        model: out.model,
        costUsd: out.costUsd,
        autoApprove: shouldAutoApprove(contentType),
      });
    } else {
      throw new Error(`Unsupported content type: ${contentType}`);
    }
  } catch (err) {
    // f. Failure handling — record the error and RETHROW so the caller's retry
    //    mechanism (BullMQ process queue: 3 attempts w/ backoff) can re-run it.
    //    We mark the row 'failed' rather than silently flipping it back to
    //    'queued' with no queue job behind it (which would strand the job).
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(autoContentJobs)
      .set({ status: "failed", lastError: message, updatedAt: new Date() })
      .where(eq(autoContentJobs.id, id));
    reportError(err, {
      where: "auto-content:job",
      jobId: id,
      contentType: job.contentType,
      topicId: job.topicId,
    });

    if (isTerminalError(err)) {
      // Auth/credit/validation — don't burn retries; signal "do not retry".
      console.error(`[orchestrator] Job ${id} terminal failure (no retry): ${message}`);
      throw new TerminalGenerationError(message);
    }

    console.error(
      `[orchestrator] Job ${id} failed (attempt ${attemptsNow}/${MAX_ATTEMPTS}): ${message}`
    );
    throw err;
  }
}

/** Persist generation metadata on the job (before publish flips the status). */
async function recordGenerationMeta(
  id: number,
  model: string,
  costUsd: number,
  timeMs: number,
  rawOutput: unknown
): Promise<void> {
  await db
    .update(autoContentJobs)
    .set({
      generationModel: model,
      generationCostUsd: costUsd.toFixed(4),
      generationTimeSecs: Math.round(timeMs / 1000),
      rawOutput: rawOutput as Record<string, unknown>,
      updatedAt: new Date(),
    })
    .where(eq(autoContentJobs.id, id));
}
