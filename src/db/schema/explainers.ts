/**
 * Adaptive Visual Explainer — decks of explanation cards per topic plus
 * per-student progress. Extension of the learn pipeline — does NOT modify
 * existing tables. See docs/adaptive-visual-explainer-prompt.md.
 */
import {
  pgTable,
  bigint,
  smallint,
  integer,
  decimal,
  varchar,
  boolean,
  timestamp,
  jsonb,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { topics, boards, standards, subjects } from "./curriculum";

export const topicExplainerDecks = pgTable(
  "topic_explainer_decks",
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
    // 1=foundation, 2=standard, 3=advanced
    level: smallint("level").notNull(),
    cardsJson: jsonb("cards_json").notNull(),
    cardCount: smallint("card_count"),
    totalReadTime: integer("total_read_time"),
    language: varchar("language", { length: 10 }).notNull().default("en"),
    generationModel: varchar("generation_model", { length: 50 }),
    generationCost: decimal("generation_cost", { precision: 6, scale: 4 }),
    qualityScore: decimal("quality_score", { precision: 3, scale: 2 }),
    viewCount: bigint("view_count", { mode: "number" }).notNull().default(0),
    avgCompletion: decimal("avg_completion", { precision: 3, scale: 2 })
      .notNull()
      .default("0.00"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_explainer_decks_topic_level_lang").on(
      table.topicId,
      table.level,
      table.language
    ),
    index("idx_explainer_decks_subject_standard_level").on(
      table.subjectId,
      table.standardId,
      table.level
    ),
    unique("uq_explainer_decks_topic_level_lang").on(
      table.topicId,
      table.level,
      table.language
    ),
  ]
);

export const studentExplainerProgress = pgTable(
  "student_explainer_progress",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    studentId: bigint("student_id", { mode: "number" })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    topicId: bigint("topic_id", { mode: "number" })
      .notNull()
      .references(() => topics.id, { onDelete: "cascade" }),
    deckId: bigint("deck_id", { mode: "number" }).references(() => topicExplainerDecks.id, {
      onDelete: "set null",
    }),
    currentCard: smallint("current_card").notNull().default(1),
    // 1=foundation, 2=standard, 3=advanced
    currentLevel: smallint("current_level").notNull().default(2),
    cardsCompleted: smallint("cards_completed").notNull().default(0),
    reExplanations: smallint("re_explanations").notNull().default(0),
    questionsAsked: smallint("questions_asked").notNull().default(0),
    levelDropped: boolean("level_dropped").notNull().default(false),
    levelRaised: boolean("level_raised").notNull().default(false),
    completed: boolean("completed").notNull().default(false),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    timeSpentSecs: integer("time_spent_secs").notNull().default(0),
    // Approaches used across the session (re-explanations) so the AI never repeats
    approachesUsed: jsonb("approaches_used").notNull().default([]),
    // Real-time re-explanation and Q&A cards generated for this student
    extraCards: jsonb("extra_cards").notNull().default([]),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_explainer_progress_student_completed").on(
      table.studentId,
      table.completed
    ),
    index("idx_explainer_progress_topic_completed").on(
      table.topicId,
      table.completed
    ),
    unique("uq_explainer_progress_student_topic").on(table.studentId, table.topicId),
  ]
);
