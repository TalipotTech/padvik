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
  unique,
} from "drizzle-orm/pg-core";

export const boards = pgTable("boards", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  code: varchar("code", { length: 20 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  fullName: text("full_name"),
  state: varchar("state", { length: 100 }),
  websiteUrl: text("website_url"),
  syllabusUrl: text("syllabus_url"),
  isActive: boolean("is_active").notNull().default(true),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const standards = pgTable(
  "standards",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    boardId: bigint("board_id", { mode: "number" })
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
    grade: smallint("grade").notNull(),
    stream: varchar("stream", { length: 50 }),
    academicYear: varchar("academic_year", { length: 10 }).notNull(),
    isActive: boolean("is_active").notNull().default(true),
    metadata: jsonb("metadata").default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_standards_board_id").on(table.boardId),
    unique("uq_standards_board_grade_stream_year").on(
      table.boardId,
      table.grade,
      table.stream,
      table.academicYear
    ),
  ]
);

export const subjects = pgTable(
  "subjects",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    standardId: bigint("standard_id", { mode: "number" })
      .notNull()
      .references(() => standards.id, { onDelete: "cascade" }),
    code: varchar("code", { length: 50 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    nameLocal: varchar("name_local", { length: 255 }),
    subjectType: varchar("subject_type", { length: 20 }).notNull().default("theory"),
    isElective: boolean("is_elective").notNull().default(false),
    maxMarks: smallint("max_marks"),
    metadata: jsonb("metadata").default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_subjects_standard_id").on(table.standardId),
    unique("uq_subjects_standard_code").on(table.standardId, table.code),
  ]
);

export const chapters = pgTable(
  "chapters",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    subjectId: bigint("subject_id", { mode: "number" })
      .notNull()
      .references(() => subjects.id, { onDelete: "cascade" }),
    chapterNumber: smallint("chapter_number").notNull(),
    title: varchar("title", { length: 500 }).notNull(),
    titleLocal: varchar("title_local", { length: 500 }),
    description: text("description"),
    textbookRef: varchar("textbook_ref", { length: 255 }),
    estimatedHours: decimal("estimated_hours", { precision: 4, scale: 1 }),
    weightagePct: decimal("weightage_pct", { precision: 5, scale: 2 }),
    metadata: jsonb("metadata").default({}),
    sortOrder: smallint("sort_order").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_chapters_subject_id").on(table.subjectId),
    unique("uq_chapters_subject_number").on(table.subjectId, table.chapterNumber),
  ]
);

export const topics = pgTable(
  "topics",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    chapterId: bigint("chapter_id", { mode: "number" })
      .notNull()
      .references(() => chapters.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 500 }).notNull(),
    titleLocal: varchar("title_local", { length: 500 }),
    description: text("description"),
    learningObjectives: jsonb("learning_objectives").default([]),
    bloomLevel: varchar("bloom_level", { length: 20 }),
    estimatedMinutes: smallint("estimated_minutes"),
    sortOrder: smallint("sort_order").notNull(),
    metadata: jsonb("metadata").default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_topics_chapter_id").on(table.chapterId)]
);

export const topicMappings = pgTable(
  "topic_mappings",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    sourceTopicId: bigint("source_topic_id", { mode: "number" })
      .notNull()
      .references(() => topics.id, { onDelete: "cascade" }),
    targetTopicId: bigint("target_topic_id", { mode: "number" })
      .notNull()
      .references(() => topics.id, { onDelete: "cascade" }),
    similarityScore: decimal("similarity_score", { precision: 3, scale: 2 }),
    mappingType: varchar("mapping_type", { length: 20 }).notNull().default("equivalent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_topic_mappings_source").on(table.sourceTopicId),
    index("idx_topic_mappings_target").on(table.targetTopicId),
  ]
);
