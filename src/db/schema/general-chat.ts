import {
  pgTable,
  bigint,
  varchar,
  text,
  integer,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { users } from "./auth";

/**
 * General AI chat conversations — NOT tied to any specific topic.
 * This is the floating "Ask AI" widget that works across the entire app.
 * Separate from topic_conversations which is context-specific.
 */
export const generalConversations = pgTable(
  "general_conversations",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Short title/keyword extracted from first message */
    title: varchar("title", { length: 500 }),
    /** Full message history as JSON array */
    messages: jsonb("messages").notNull().default([]),
    messageCount: integer("message_count").notNull().default(0),
    totalTokens: integer("total_tokens").notNull().default(0),
    /** AI provider used */
    aiProvider: varchar("ai_provider", { length: 30 }),
    /** Board context (optional — enriches AI responses) */
    boardCode: varchar("board_code", { length: 20 }),
    grade: integer("grade"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_general_conversations_user").on(table.userId),
  ]
);
