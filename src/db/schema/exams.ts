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
import { subjects } from "./curriculum";
import { questions } from "./questions";

export const exams = pgTable(
  "exams",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    title: varchar("title", { length: 500 }).notNull(),
    description: text("description"),
    examType: varchar("exam_type", { length: 30 }).notNull(),
    createdBy: bigint("created_by", { mode: "number" })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    subjectId: bigint("subject_id", { mode: "number" }).references(() => subjects.id, {
      onDelete: "set null",
    }),
    chapterIds: bigint("chapter_ids", { mode: "number" }).array().default([]),
    topicIds: bigint("topic_ids", { mode: "number" }).array().default([]),
    generationMode: varchar("generation_mode", { length: 20 }).notNull(),
    totalMarks: decimal("total_marks", { precision: 6, scale: 1 }).notNull(),
    durationMinutes: smallint("duration_minutes").notNull(),
    negativeMarking: boolean("negative_marking").notNull().default(false),
    negativePct: decimal("negative_pct", { precision: 4, scale: 2 }).notNull().default("0"),
    passingPct: decimal("passing_pct", { precision: 5, scale: 2 }).notNull().default("35.00"),
    difficultyMix: jsonb("difficulty_mix").default({ easy: 30, medium: 50, hard: 20 }),
    questionTypeMix: jsonb("question_type_mix"),
    isPublished: boolean("is_published").notNull().default(false),
    isTimed: boolean("is_timed").notNull().default(true),
    allowReview: boolean("allow_review").notNull().default(true),
    shuffleQuestions: boolean("shuffle_questions").notNull().default(true),
    shuffleOptions: boolean("shuffle_options").notNull().default(true),
    maxAttempts: smallint("max_attempts").notNull().default(1),
    availableFrom: timestamp("available_from", { withTimezone: true }),
    availableUntil: timestamp("available_until", { withTimezone: true }),
    metadata: jsonb("metadata").default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_exams_created_by").on(table.createdBy)]
);

export const examQuestions = pgTable(
  "exam_questions",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    examId: bigint("exam_id", { mode: "number" })
      .notNull()
      .references(() => exams.id, { onDelete: "cascade" }),
    questionId: bigint("question_id", { mode: "number" })
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    sortOrder: smallint("sort_order").notNull(),
    sectionLabel: varchar("section_label", { length: 50 }),
    marksOverride: decimal("marks_override", { precision: 4, scale: 1 }),
    isCompulsory: boolean("is_compulsory").notNull().default(true),
  },
  (table) => [index("idx_exam_questions_exam_id").on(table.examId)]
);

export const examAttempts = pgTable(
  "exam_attempts",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    examId: bigint("exam_id", { mode: "number" })
      .notNull()
      .references(() => exams.id, { onDelete: "cascade" }),
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    attemptNumber: smallint("attempt_number").notNull().default(1),
    status: varchar("status", { length: 20 }).notNull().default("started"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    timeSpentSeconds: integer("time_spent_seconds"),
    totalScore: decimal("total_score", { precision: 6, scale: 1 }),
    maxScore: decimal("max_score", { precision: 6, scale: 1 }),
    percentage: decimal("percentage", { precision: 5, scale: 2 }),
    grade: varchar("grade", { length: 5 }),
    evaluationMode: varchar("evaluation_mode", { length: 20 }).notNull().default("auto"),
    evaluatedBy: bigint("evaluated_by", { mode: "number" }).references(() => users.id, {
      onDelete: "set null",
    }),
    evaluatedAt: timestamp("evaluated_at", { withTimezone: true }),
    feedback: text("feedback"),
    metadata: jsonb("metadata").default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_exam_attempts_exam_id").on(table.examId),
    index("idx_exam_attempts_user_id").on(table.userId),
  ]
);

export const examResponses = pgTable(
  "exam_responses",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    attemptId: bigint("attempt_id", { mode: "number" })
      .notNull()
      .references(() => examAttempts.id, { onDelete: "cascade" }),
    questionId: bigint("question_id", { mode: "number" })
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    responseText: text("response_text"),
    selectedOptionIds: jsonb("selected_option_ids"),
    responseImages: jsonb("response_images").default([]),
    isCorrect: boolean("is_correct"),
    marksObtained: decimal("marks_obtained", { precision: 4, scale: 1 }),
    timeSpentSeconds: integer("time_spent_seconds"),
    aiEvaluation: jsonb("ai_evaluation"),
    teacherEvaluation: jsonb("teacher_evaluation"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_exam_responses_attempt_id").on(table.attemptId)]
);
