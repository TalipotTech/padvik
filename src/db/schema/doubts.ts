import {
  pgTable,
  bigint,
  varchar,
  text,
  boolean,
  integer,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { creatorContent } from "./creators";
import { topics } from "./curriculum";

// ---------------------------------------------------------------------------
// Doubts
// ---------------------------------------------------------------------------
export const doubts = pgTable(
  "doubts",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    studentId: bigint("student_id", { mode: "number" })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    creatorId: bigint("creator_id", { mode: "number" }).references(() => users.id, {
      onDelete: "set null",
    }),
    contentId: bigint("content_id", { mode: "number" }).references(() => creatorContent.id, {
      onDelete: "set null",
    }),
    topicId: bigint("topic_id", { mode: "number" }).references(() => topics.id, {
      onDelete: "set null",
    }),
    questionText: text("question_text").notNull(),
    questionImages: jsonb("question_images").default([]),
    status: varchar("status", { length: 20 }).notNull().default("open"), // open, ai_answered, creator_answered, closed
    upvoteCount: integer("upvote_count").notNull().default(0),
    // --- Added in pipeline phase ---
    classroomId: bigint("classroom_id", { mode: "number" }), // nullable — null = via follow/browse
    isPublic: boolean("is_public").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_doubts_student_id").on(table.studentId),
    index("idx_doubts_creator_id").on(table.creatorId),
    index("idx_doubts_topic_id").on(table.topicId),
    index("idx_doubts_status").on(table.status),
    index("idx_doubts_classroom_id").on(table.classroomId),
  ]
);

// ---------------------------------------------------------------------------
// Doubt Responses
// ---------------------------------------------------------------------------
export const doubtResponses = pgTable(
  "doubt_responses",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    doubtId: bigint("doubt_id", { mode: "number" })
      .notNull()
      .references(() => doubts.id, { onDelete: "cascade" }),
    responderId: bigint("responder_id", { mode: "number" })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    responseText: text("response_text").notNull(),
    responseType: varchar("response_type", { length: 20 }).notNull().default("text"), // text, audio, video
    mediaUrl: text("media_url"),
    isAi: boolean("is_ai").notNull().default(false),
    isAccepted: boolean("is_accepted").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_doubt_responses_doubt_id").on(table.doubtId),
    index("idx_doubt_responses_responder_id").on(table.responderId),
  ]
);
