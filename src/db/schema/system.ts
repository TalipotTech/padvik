import {
  pgTable,
  bigint,
  varchar,
  text,
  smallint,
  integer,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { boards, standards } from "./curriculum";
import { users } from "./auth";

export const scrapeJobs = pgTable(
  "scrape_jobs",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    jobType: varchar("job_type", { length: 30 }).notNull(),
    sourceUrl: text("source_url").notNull(),
    boardId: bigint("board_id", { mode: "number" }).references(() => boards.id, {
      onDelete: "set null",
    }),
    standardId: bigint("standard_id", { mode: "number" }).references(() => standards.id, {
      onDelete: "set null",
    }),
    status: varchar("status", { length: 20 }).notNull().default("queued"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    itemsFound: integer("items_found").notNull().default(0),
    itemsProcessed: integer("items_processed").notNull().default(0),
    errorLog: text("error_log"),
    retryCount: smallint("retry_count").notNull().default(0),
    metadata: jsonb("metadata").default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_scrape_jobs_status").on(table.status)]
);

export const contentPipelineLogs = pgTable(
  "content_pipeline_logs",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    pipelineStage: varchar("pipeline_stage", { length: 30 }).notNull(),
    entityType: varchar("entity_type", { length: 30 }).notNull(),
    entityId: bigint("entity_id", { mode: "number" }).notNull(),
    status: varchar("status", { length: 20 }).notNull(),
    inputData: jsonb("input_data"),
    outputData: jsonb("output_data"),
    processingTimeMs: integer("processing_time_ms"),
    aiModelUsed: varchar("ai_model_used", { length: 50 }),
    aiTokensUsed: integer("ai_tokens_used"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_pipeline_logs_stage").on(table.pipelineStage),
    index("idx_pipeline_logs_entity").on(table.entityType, table.entityId),
  ]
);

export const systemConfig = pgTable("system_config", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  configKey: varchar("config_key", { length: 100 }).notNull().unique(),
  configValue: jsonb("config_value").notNull(),
  description: text("description"),
  updatedBy: bigint("updated_by", { mode: "number" }).references(() => users.id, {
    onDelete: "set null",
  }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
