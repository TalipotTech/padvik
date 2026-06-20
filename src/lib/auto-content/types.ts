/**
 * Shared types for the auto-content generation pipeline.
 * These mirror the varchar enums defined in src/db/schema/auto-content.ts.
 */

// ---------------------------------------------------------------------------
// Enums (string unions kept in sync with DB CHECK/varchar values)
// ---------------------------------------------------------------------------

/** Student behaviour signals that indicate demand for content on a topic. */
export type DemandSignalType =
  | "search"
  | "view"
  | "ask_ai"
  | "explainer_stuck"
  | "exam_weak"
  | "doubt_posted"
  | "direct_request";

/** Kinds of content the pipeline can auto-generate. */
export type ContentGenerationType =
  | "text_note"
  | "audio_explainer"
  | "video_lesson"
  | "question_set";

/** Lifecycle status of an auto_content_jobs row. */
export type AutoContentJobStatus =
  | "queued"
  | "generating"
  | "reviewing"
  | "published"
  | "failed"
  | "rejected";

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

/**
 * Aggregated demand for a single topic over the scoring window.
 * Produced by calculateDemandScores().
 */
export interface DemandScore {
  topicId: number;
  /** SUM(weight) × LN(distinct students + 1) */
  score: number;
  uniqueStudents: number;
  totalSignals: number;
  /** Count of signals per signal type for this topic. */
  breakdown: Partial<Record<DemandSignalType, number>>;
}

/**
 * Outcome of a single content generation attempt.
 * Returned by the per-type generators (text-note, question-set, …).
 */
export interface GenerationResult {
  success: boolean;
  contentType: ContentGenerationType;
  /** Human-readable title for the generated content, when produced. */
  title?: string;
  /** Rendered/text body, when the content type produces one. */
  body?: string;
  /** Structured output (e.g. ContentBlock[] or question array) for storage/audit. */
  rawOutput: unknown;
  /** Model id that produced the content (e.g. "claude-sonnet-4-6"). */
  model: string;
  /** Estimated cost of this generation in USD. */
  costUsd: number;
  /** Wall-clock generation time in seconds. */
  durationSecs: number;
  /** Total tokens (input + output) consumed, when available. */
  tokensUsed?: number;
  /** Populated when success === false. */
  error?: string;
}

/**
 * Snapshot of the daily AI content generation budget.
 * Used by the scheduler to decide whether more jobs may run today.
 */
export interface ContentBudgetStatus {
  /** ISO date (YYYY-MM-DD) the budget applies to. */
  date: string;
  /** Configured ceiling for the day (DAILY_CONTENT_BUDGET), in USD. */
  budgetUsd: number;
  /** Amount already spent today, in USD. */
  spentUsd: number;
  /** budgetUsd − spentUsd, clamped at 0. */
  remainingUsd: number;
  /** Number of generation jobs run today. */
  jobsRun: number;
  /** True when spentUsd has reached or exceeded budgetUsd. */
  isExhausted: boolean;
}
