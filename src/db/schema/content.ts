import {
  pgTable,
  bigint,
  varchar,
  text,
  boolean,
  integer,
  timestamp,
  jsonb,
  decimal,
  index,
} from "drizzle-orm/pg-core";
import { topics } from "./curriculum";
import { users } from "./auth";

export const contentItems = pgTable(
  "content_items",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    topicId: bigint("topic_id", { mode: "number" })
      .notNull()
      .references(() => topics.id, { onDelete: "cascade" }),
    contentType: varchar("content_type", { length: 30 }).notNull(),
    title: varchar("title", { length: 500 }).notNull(),
    body: text("body").notNull(),
    bodyFormat: varchar("body_format", { length: 10 }).notNull().default("markdown"),
    sourceType: varchar("source_type", { length: 30 }).notNull(),
    sourceUrl: text("source_url"),
    uploadedBy: bigint("uploaded_by", { mode: "number" }).references(() => users.id, {
      onDelete: "set null",
    }),
    language: varchar("language", { length: 10 }).notNull().default("en"),
    qualityScore: decimal("quality_score", { precision: 3, scale: 2 }).default("0.00"),
    reviewStatus: varchar("review_status", { length: 20 }).notNull().default("pending"),
    reviewedBy: bigint("reviewed_by", { mode: "number" }).references(() => users.id, {
      onDelete: "set null",
    }),
    viewCount: bigint("view_count", { mode: "number" }).notNull().default(0),
    upvoteCount: integer("upvote_count").notNull().default(0),
    isPublished: boolean("is_published").notNull().default(false),
    metadata: jsonb("metadata").default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_content_items_topic_id").on(table.topicId),
    index("idx_content_items_review_status").on(table.reviewStatus),
  ]
);

export const userNotes = pgTable(
  "user_notes",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    topicId: bigint("topic_id", { mode: "number" }).references(() => topics.id, {
      onDelete: "set null",
    }),
    contentItemId: bigint("content_item_id", { mode: "number" }).references(
      () => contentItems.id,
      { onDelete: "set null" }
    ),
    title: varchar("title", { length: 500 }),
    body: text("body").notNull(),
    bodyFormat: varchar("body_format", { length: 10 }).notNull().default("markdown"),
    isPrivate: boolean("is_private").notNull().default(true),
    tags: text("tags").array().default([]),
    /** "typed" for text notes, "handwritten" for photo uploads with OCR */
    noteType: varchar("note_type", { length: 20 }).notNull().default("typed"),
    /** URL/path to uploaded handwritten note image */
    imageUrl: text("image_url"),
    /** FK to fileUploads record for the image */
    imageFileId: bigint("image_file_id", { mode: "number" }).references(
      () => fileUploads.id,
      { onDelete: "set null" }
    ),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_user_notes_user_id").on(table.userId),
    index("idx_user_notes_topic_id").on(table.topicId),
  ]
);

export const fileUploads = pgTable(
  "file_uploads",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    userId: bigint("user_id", { mode: "number" }).references(() => users.id, {
      onDelete: "set null",
    }),
    fileName: varchar("file_name", { length: 500 }).notNull(),
    fileType: varchar("file_type", { length: 20 }).notNull(),
    fileSizeBytes: bigint("file_size_bytes", { mode: "number" }),
    storageKey: text("storage_key").notNull(),
    storageUrl: text("storage_url").notNull(),
    processingStatus: varchar("processing_status", { length: 20 }).notNull().default("uploaded"),
    extractedText: text("extracted_text"),
    extractedContentIds: bigint("extracted_content_ids", { mode: "number" }).array(),
    uploadContext: varchar("upload_context", { length: 30 }),
    metadata: jsonb("metadata").default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_file_uploads_user_id").on(table.userId)]
);
