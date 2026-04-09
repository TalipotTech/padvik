import {
  pgTable,
  bigint,
  varchar,
  text,
  smallint,
  boolean,
  date,
  timestamp,
  jsonb,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { boards } from "./curriculum";

export const boardNotifications = pgTable(
  "board_notifications",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    boardId: bigint("board_id", { mode: "number" })
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 1000 }).notNull(),
    slug: varchar("slug", { length: 500 }),
    category: varchar("category", { length: 30 }).notNull(),
    summary: text("summary"),
    sourceUrl: text("source_url").notNull(),
    pdfUrl: text("pdf_url"),
    affectedClasses: smallint("affected_classes").array().default([]),
    affectedSubjects: text("affected_subjects").array().default([]),
    priority: varchar("priority", { length: 10 }).notNull().default("medium"),
    isBreaking: boolean("is_breaking").notNull().default(false),
    publishedAt: date("published_at", { mode: "string" }).notNull(),
    scrapedAt: timestamp("scraped_at", { withTimezone: true }).notNull().defaultNow(),
    aiProcessed: boolean("ai_processed").notNull().default(false),
    rawHtml: text("raw_html"),
    metadata: jsonb("metadata").default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_board_notifications_board_published").on(table.boardId, table.publishedAt),
    index("idx_board_notifications_category_published").on(table.category, table.publishedAt),
    unique("uq_board_notifications_source_url").on(table.sourceUrl),
  ]
);
