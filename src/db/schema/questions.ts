import {
  pgTable,
  bigint,
  varchar,
  text,
  boolean,
  smallint,
  decimal,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { topics, boards, standards, subjects } from "./curriculum";
import { users } from "./auth";
import { fileUploads } from "./content";

export const questionPapers = pgTable(
  "question_papers",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    boardId: bigint("board_id", { mode: "number" }).references(() => boards.id, {
      onDelete: "set null",
    }),
    standardId: bigint("standard_id", { mode: "number" }).references(() => standards.id, {
      onDelete: "set null",
    }),
    subjectId: bigint("subject_id", { mode: "number" }).references(() => subjects.id, {
      onDelete: "set null",
    }),
    paperTitle: varchar("paper_title", { length: 500 }).notNull(),
    paperYear: smallint("paper_year").notNull(),
    paperMonth: varchar("paper_month", { length: 20 }),
    paperType: varchar("paper_type", { length: 30 }).notNull(),
    totalMarks: smallint("total_marks"),
    durationMinutes: smallint("duration_minutes"),
    fileUploadId: bigint("file_upload_id", { mode: "number" }).references(() => fileUploads.id, {
      onDelete: "set null",
    }),
    sourceUrl: text("source_url"),
    parsingStatus: varchar("parsing_status", { length: 20 }).notNull().default("pending"),
    parsedBy: varchar("parsed_by", { length: 30 }),
    questionCount: smallint("question_count").notNull().default(0),
    metadata: jsonb("metadata").default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_question_papers_board_year").on(table.boardId, table.paperYear)]
);

export const questions = pgTable(
  "questions",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    topicId: bigint("topic_id", { mode: "number" })
      .notNull()
      .references(() => topics.id, { onDelete: "cascade" }),
    questionType: varchar("question_type", { length: 30 }).notNull(),
    difficulty: varchar("difficulty", { length: 10 }).notNull(),
    bloomLevel: varchar("bloom_level", { length: 20 }),
    questionText: text("question_text").notNull(),
    questionHtml: text("question_html"),
    questionImages: jsonb("question_images").default([]),
    options: jsonb("options"),
    correctAnswer: text("correct_answer"),
    solution: text("solution"),
    solutionHtml: text("solution_html"),
    marks: decimal("marks", { precision: 4, scale: 1 }).notNull().default("1.0"),
    negativeMarks: decimal("negative_marks", { precision: 4, scale: 1 }).notNull().default("0.0"),
    timeSeconds: smallint("time_seconds"),
    sourceType: varchar("source_type", { length: 30 }).notNull(),
    sourceRef: varchar("source_ref", { length: 255 }),
    sourceYear: smallint("source_year"),
    sourcePaperId: bigint("source_paper_id", { mode: "number" }).references(
      () => questionPapers.id,
      { onDelete: "set null" }
    ),
    language: varchar("language", { length: 10 }).notNull().default("en"),
    isVerified: boolean("is_verified").notNull().default(false),
    verifiedBy: bigint("verified_by", { mode: "number" }).references(() => users.id, {
      onDelete: "set null",
    }),
    usageCount: bigint("usage_count", { mode: "number" }).notNull().default(0),
    avgAccuracy: decimal("avg_accuracy", { precision: 5, scale: 2 }),
    tags: text("tags").array().default([]),
    metadata: jsonb("metadata").default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_questions_topic_id").on(table.topicId),
    index("idx_questions_source_type").on(table.sourceType),
    index("idx_questions_difficulty").on(table.difficulty),
  ]
);
