/**
 * Learning Path Schema — topic search history + cached AI self-assessments.
 *
 * - topic_search_history: append-only log of every home-box search a student
 *   runs. "Recently searched first" = ORDER BY created_at DESC; de-dupe in the
 *   API read (DISTINCT ON), never with a UNIQUE constraint, so the timeline
 *   stays intact.
 * - learning_path_assessments: cached snapshots of the AI self-assessment so we
 *   regenerate at most once per (user, subject) per LEARNING_PATH_TTL_HOURS.
 *
 * These extend the existing learn.ts learning-path data sources — they do not
 * replace any progress tracking.
 */
import {
  pgTable,
  bigint,
  varchar,
  text,
  boolean,
  smallint,
  integer,
  decimal,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { topics, boards, subjects } from "./curriculum";

// ---------------------------------------------------------------------------
// Topic Search History — append-only log of student home-box searches
// ---------------------------------------------------------------------------

export const topicSearchHistory = pgTable(
  "topic_search_history",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Raw query the student typed */
    query: varchar("query", { length: 500 }).notNull(),
    /** Topic the search landed on (nullable — no match / rejected) */
    matchedTopicId: bigint("matched_topic_id", { mode: "number" }).references(
      () => topics.id,
      { onDelete: "set null" }
    ),
    boardId: bigint("board_id", { mode: "number" }).references(() => boards.id, {
      onDelete: "set null",
    }),
    grade: smallint("grade"),
    /** How many results were shown */
    resultCount: integer("result_count").notNull().default(0),
    /** True if the scope guardrail blocked this query */
    wasRejected: boolean("was_rejected").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_topic_search_history_user_created").on(table.userId, table.createdAt.desc()),
    index("idx_topic_search_history_matched_topic").on(table.matchedTopicId),
  ]
);

// ---------------------------------------------------------------------------
// Learning Path Assessments — cached AI self-assessment snapshots
// ---------------------------------------------------------------------------

export const learningPathAssessments = pgTable(
  "learning_path_assessments",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    boardId: bigint("board_id", { mode: "number" }).references(() => boards.id, {
      onDelete: "set null",
    }),
    grade: smallint("grade"),
    /** Nullable = whole-grade assessment; set = single-subject assessment */
    subjectId: bigint("subject_id", { mode: "number" }).references(() => subjects.id, {
      onDelete: "cascade",
    }),
    /**
     * Snapshot of the signals the assessment was computed from (audit + no
     * recompute on read). Shape:
     * { redTopics, orangeTopics, greenTopics, avgCompletion, examWeakTopics, stuckTopics }
     */
    signalsJson: jsonb("signals_json").notNull().default({}),
    /** AI output — 2-3 sentence plain-language status */
    summary: text("summary"),
    /** [{ topicId, title, reason }] */
    strengthsJson: jsonb("strengths_json").default([]),
    /** [{ topicId, title, reason, priority, suggestedAction, contentItemId? }] */
    improvementsJson: jsonb("improvements_json").default([]),
    /** 0-100 readiness score (computed deterministically, never AI-dependent) */
    overallScore: decimal("overall_score", { precision: 4, scale: 2 }),
    generationModel: varchar("generation_model", { length: 50 }),
    generationCost: decimal("generation_cost", { precision: 8, scale: 4 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_learning_path_assessments_user_subject_created").on(
      table.userId,
      table.subjectId,
      table.createdAt.desc()
    ),
  ]
);
