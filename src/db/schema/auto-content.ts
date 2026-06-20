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
  unique,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { boards, standards, subjects, topics } from "./curriculum";
import { creatorContent } from "./creators";

// ---------------------------------------------------------------------------
// Auto Content Jobs — tracks every AI content generation job
// ---------------------------------------------------------------------------
export const autoContentJobs = pgTable(
  "auto_content_jobs",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    topicId: bigint("topic_id", { mode: "number" })
      .notNull()
      .references(() => topics.id, { onDelete: "cascade" }),
    boardId: bigint("board_id", { mode: "number" }).references(() => boards.id, {
      onDelete: "set null",
    }),
    standardId: bigint("standard_id", { mode: "number" }).references(() => standards.id, {
      onDelete: "set null",
    }),
    subjectId: bigint("subject_id", { mode: "number" }).references(() => subjects.id, {
      onDelete: "set null",
    }),
    // text_note, audio_explainer, video_lesson, question_set
    contentType: varchar("content_type", { length: 30 }).notNull(),
    // Admin-requested model for this job ("default" = configured rotation).
    // Part of the unique key so a different model yields a separate content item.
    requestedModel: varchar("requested_model", { length: 50 }).notNull().default("default"),
    priority: integer("priority").notNull().default(50), // 0 = highest, 100 = lowest
    demandScore: decimal("demand_score", { precision: 5, scale: 2 }).notNull().default("0"),
    // queued, generating, reviewing, published, failed, rejected
    status: varchar("status", { length: 20 }).notNull().default("queued"),
    contentId: bigint("content_id", { mode: "number" }).references(() => creatorContent.id, {
      onDelete: "set null",
    }),
    generationPrompt: text("generation_prompt"),
    generationModel: varchar("generation_model", { length: 50 }),
    generationCostUsd: decimal("generation_cost_usd", { precision: 8, scale: 4 }),
    generationTimeSecs: integer("generation_time_secs"),
    rawOutput: jsonb("raw_output"),
    autoApproved: boolean("auto_approved").notNull().default(false),
    reviewedBy: bigint("reviewed_by", { mode: "number" }).references(() => users.id, {
      onDelete: "set null",
    }),
    reviewNotes: text("review_notes"),
    attempts: smallint("attempts").notNull().default(0),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("uq_auto_content_jobs_topic_type_model").on(
      table.topicId,
      table.contentType,
      table.requestedModel
    ),
    index("idx_auto_content_jobs_queue").on(
      table.status,
      table.priority,
      table.demandScore.desc()
    ),
    index("idx_auto_content_jobs_type_status").on(table.contentType, table.status),
    index("idx_auto_content_jobs_topic_id").on(table.topicId),
  ]
);

// ---------------------------------------------------------------------------
// Content Demand Signals — student behavior indicating demand for a topic
// ---------------------------------------------------------------------------
export const contentDemandSignals = pgTable(
  "content_demand_signals",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    topicId: bigint("topic_id", { mode: "number" })
      .notNull()
      .references(() => topics.id, { onDelete: "cascade" }),
    // search, view, ask_ai, explainer_stuck, exam_weak, doubt_posted, direct_request
    signalType: varchar("signal_type", { length: 30 }).notNull(),
    studentId: bigint("student_id", { mode: "number" }).references(() => users.id, {
      onDelete: "set null",
    }),
    weight: decimal("weight", { precision: 3, scale: 1 }).notNull().default("1.0"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_content_demand_signals_topic_created").on(
      table.topicId,
      table.createdAt.desc()
    ),
    index("idx_content_demand_signals_type").on(table.signalType),
  ]
);
