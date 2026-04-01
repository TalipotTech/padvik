import {
  pgTable,
  bigint,
  varchar,
  smallint,
  integer,
  decimal,
  date,
  timestamp,
  jsonb,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { topics, subjects, chapters } from "./curriculum";

export const studentProgress = pgTable(
  "student_progress",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    topicId: bigint("topic_id", { mode: "number" })
      .notNull()
      .references(() => topics.id, { onDelete: "cascade" }),
    masteryLevel: decimal("mastery_level", { precision: 3, scale: 2 }).notNull().default("0.00"),
    confidence: decimal("confidence", { precision: 3, scale: 2 }).notNull().default("0.00"),
    totalQuestionsAttempted: integer("total_questions_attempted").notNull().default(0),
    correctAnswers: integer("correct_answers").notNull().default(0),
    timeSpentMinutes: integer("time_spent_minutes").notNull().default(0),
    lastStudiedAt: timestamp("last_studied_at", { withTimezone: true }),
    nextReviewAt: timestamp("next_review_at", { withTimezone: true }),
    streakDays: smallint("streak_days").notNull().default(0),
    metadata: jsonb("metadata").default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_student_progress_user_id").on(table.userId),
    index("idx_student_progress_topic_id").on(table.topicId),
    unique("uq_student_progress_user_topic").on(table.userId, table.topicId),
  ]
);

export const learningSessions = pgTable(
  "learning_sessions",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sessionType: varchar("session_type", { length: 30 }).notNull(),
    subjectId: bigint("subject_id", { mode: "number" }).references(() => subjects.id, {
      onDelete: "set null",
    }),
    chapterId: bigint("chapter_id", { mode: "number" }).references(() => chapters.id, {
      onDelete: "set null",
    }),
    topicId: bigint("topic_id", { mode: "number" }).references(() => topics.id, {
      onDelete: "set null",
    }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    durationMinutes: integer("duration_minutes"),
    pagesRead: smallint("pages_read"),
    questionsAttempted: smallint("questions_attempted"),
    questionsCorrect: smallint("questions_correct"),
    metadata: jsonb("metadata").default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_learning_sessions_user_id").on(table.userId)]
);

export const performanceReports = pgTable(
  "performance_reports",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    reportType: varchar("report_type", { length: 30 }).notNull(),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    subjectId: bigint("subject_id", { mode: "number" }).references(() => subjects.id, {
      onDelete: "set null",
    }),
    summary: jsonb("summary").notNull(),
    recommendations: jsonb("recommendations").default([]),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_performance_reports_user_id").on(table.userId)]
);
