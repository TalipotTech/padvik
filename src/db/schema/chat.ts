import {
  pgTable,
  bigint,
  varchar,
  text,
  smallint,
  integer,
  boolean,
  decimal,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { topics, subjects } from "./curriculum";

export const conversations = pgTable(
  "conversations",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 500 }),
    contextType: varchar("context_type", { length: 30 }),
    topicId: bigint("topic_id", { mode: "number" }).references(() => topics.id, {
      onDelete: "set null",
    }),
    subjectId: bigint("subject_id", { mode: "number" }).references(() => subjects.id, {
      onDelete: "set null",
    }),
    modelUsed: varchar("model_used", { length: 50 }),
    messageCount: smallint("message_count").notNull().default(0),
    tokenCount: integer("token_count").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_conversations_user_id").on(table.userId)]
);

export const messages = pgTable(
  "messages",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    conversationId: bigint("conversation_id", { mode: "number" })
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 10 }).notNull(),
    content: text("content").notNull(),
    contentType: varchar("content_type", { length: 20 }).notNull().default("text"),
    attachments: jsonb("attachments").default([]),
    tokenCount: integer("token_count"),
    modelUsed: varchar("model_used", { length: 50 }),
    costUsd: decimal("cost_usd", { precision: 8, scale: 6 }),
    metadata: jsonb("metadata").default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_messages_conversation_id").on(table.conversationId)]
);
