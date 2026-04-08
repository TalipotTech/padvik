/**
 * Learn System Schema — reading progress, highlights, bookmarks, AI conversations
 *
 * Supports the ExamForge-style learning experience:
 * - Section-by-section reading progress with auto-tracking
 * - Text highlighting and annotations
 * - Topic bookmarks
 * - AI tutor conversations per topic
 */
import {
  pgTable,
  bigint,
  varchar,
  text,
  boolean,
  smallint,
  integer,
  timestamp,
  jsonb,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { topics } from "./curriculum";
import { contentItems } from "./content";

// ---------------------------------------------------------------------------
// Reading Progress — tracks which sections a user has read per content item
// ---------------------------------------------------------------------------

export const readingProgress = pgTable(
  "reading_progress",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    contentItemId: bigint("content_item_id", { mode: "number" })
      .notNull()
      .references(() => contentItems.id, { onDelete: "cascade" }),
    /** JSON array of section IDs that have been read */
    sectionsRead: jsonb("sections_read").default([]),
    /** 0-100 completion percentage */
    completionPercent: smallint("completion_percent").notNull().default(0),
    /** When the user last opened this content */
    lastReadAt: timestamp("last_read_at", { withTimezone: true }).notNull().defaultNow(),
    /** Cumulative reading time in seconds */
    totalReadTimeSeconds: integer("total_read_time_seconds").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("uq_reading_progress_user_content").on(table.userId, table.contentItemId),
    index("idx_reading_progress_user").on(table.userId),
  ]
);

// ---------------------------------------------------------------------------
// User Highlights — text selections with optional notes
// ---------------------------------------------------------------------------

export const userHighlights = pgTable(
  "user_highlights",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    contentItemId: bigint("content_item_id", { mode: "number" })
      .notNull()
      .references(() => contentItems.id, { onDelete: "cascade" }),
    /** The actual text that was highlighted */
    highlightedText: text("highlighted_text").notNull(),
    /** Optional note/annotation on the highlight */
    note: text("note"),
    /** Highlight color: yellow, green, blue, pink */
    color: varchar("color", { length: 20 }).notNull().default("yellow"),
    /** Character offset positions in the content body for rendering */
    startOffset: integer("start_offset").notNull(),
    endOffset: integer("end_offset").notNull(),
    /** Optional section ID for multi-section content */
    sectionId: varchar("section_id", { length: 100 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_user_highlights_user").on(table.userId),
    index("idx_user_highlights_content").on(table.contentItemId),
  ]
);

// ---------------------------------------------------------------------------
// User Bookmarks — saved topics for quick access
// ---------------------------------------------------------------------------

export const userBookmarks = pgTable(
  "user_bookmarks",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    topicId: bigint("topic_id", { mode: "number" })
      .notNull()
      .references(() => topics.id, { onDelete: "cascade" }),
    contentItemId: bigint("content_item_id", { mode: "number" }).references(
      () => contentItems.id,
      { onDelete: "set null" }
    ),
    title: varchar("title", { length: 500 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("uq_user_bookmarks_user_topic").on(table.userId, table.topicId),
    index("idx_user_bookmarks_user").on(table.userId),
  ]
);

// ---------------------------------------------------------------------------
// Topic Conversations — AI tutor chat history per topic
// ---------------------------------------------------------------------------

export const topicConversations = pgTable(
  "topic_conversations",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    topicId: bigint("topic_id", { mode: "number" })
      .notNull()
      .references(() => topics.id, { onDelete: "cascade" }),
    /** JSON array of { role: 'user'|'assistant', content: string, timestamp: string } */
    messages: jsonb("messages").default([]),
    messageCount: integer("message_count").notNull().default(0),
    /** Which AI provider was last used */
    aiProvider: varchar("ai_provider", { length: 30 }),
    /** Total tokens used across all messages */
    totalTokens: integer("total_tokens").notNull().default(0),
    /** First user question — used as conversation title */
    keyword: varchar("keyword", { length: 500 }),
    /** Whether any message was saved as a note */
    savedAsNote: boolean("saved_as_note").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_topic_conversations_user").on(table.userId),
    index("idx_topic_conversations_topic").on(table.topicId),
  ]
);

// ---------------------------------------------------------------------------
// Topic Understanding — per-topic comprehension rating (red/orange/green)
// ---------------------------------------------------------------------------

export const topicUnderstanding = pgTable(
  "topic_understanding",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    topicId: bigint("topic_id", { mode: "number" })
      .notNull()
      .references(() => topics.id, { onDelete: "cascade" }),
    /** red = tough, orange = almost ok, green = understood */
    understandingLevel: varchar("understanding_level", { length: 10 }).notNull().default("green"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("uq_topic_understanding_user_topic").on(table.userId, table.topicId),
    index("idx_topic_understanding_user").on(table.userId),
  ]
);

// ---------------------------------------------------------------------------
// User Videos — YouTube links saved per topic in the Playground
// ---------------------------------------------------------------------------

export const userVideos = pgTable(
  "user_videos",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    topicId: bigint("topic_id", { mode: "number" })
      .notNull()
      .references(() => topics.id, { onDelete: "cascade" }),
    youtubeUrl: text("youtube_url").notNull(),
    title: varchar("title", { length: 500 }),
    thumbnailUrl: text("thumbnail_url"),
    durationSeconds: integer("duration_seconds"),
    sortOrder: smallint("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_user_videos_user_topic").on(table.userId, table.topicId),
  ]
);
