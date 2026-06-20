CREATE TABLE "auto_content_jobs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "auto_content_jobs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"topic_id" bigint NOT NULL,
	"board_id" bigint,
	"standard_id" bigint,
	"subject_id" bigint,
	"content_type" varchar(30) NOT NULL,
	"priority" integer DEFAULT 50 NOT NULL,
	"demand_score" numeric(5, 2) DEFAULT '0' NOT NULL,
	"status" varchar(20) DEFAULT 'queued' NOT NULL,
	"content_id" bigint,
	"generation_prompt" text,
	"generation_model" varchar(50),
	"generation_cost_usd" numeric(8, 4),
	"generation_time_secs" integer,
	"raw_output" jsonb,
	"auto_approved" boolean DEFAULT false NOT NULL,
	"reviewed_by" bigint,
	"review_notes" text,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_auto_content_jobs_topic_type" UNIQUE("topic_id","content_type")
);
--> statement-breakpoint
CREATE TABLE "content_demand_signals" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "content_demand_signals_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"topic_id" bigint NOT NULL,
	"signal_type" varchar(30) NOT NULL,
	"student_id" bigint,
	"weight" numeric(3, 1) DEFAULT '1.0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auto_content_jobs" ADD CONSTRAINT "auto_content_jobs_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_content_jobs" ADD CONSTRAINT "auto_content_jobs_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_content_jobs" ADD CONSTRAINT "auto_content_jobs_standard_id_standards_id_fk" FOREIGN KEY ("standard_id") REFERENCES "public"."standards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_content_jobs" ADD CONSTRAINT "auto_content_jobs_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_content_jobs" ADD CONSTRAINT "auto_content_jobs_content_id_creator_content_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."creator_content"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_content_jobs" ADD CONSTRAINT "auto_content_jobs_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_demand_signals" ADD CONSTRAINT "content_demand_signals_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_demand_signals" ADD CONSTRAINT "content_demand_signals_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_auto_content_jobs_queue" ON "auto_content_jobs" USING btree ("status","priority","demand_score" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_auto_content_jobs_type_status" ON "auto_content_jobs" USING btree ("content_type","status");--> statement-breakpoint
CREATE INDEX "idx_auto_content_jobs_topic_id" ON "auto_content_jobs" USING btree ("topic_id");--> statement-breakpoint
CREATE INDEX "idx_content_demand_signals_topic_created" ON "content_demand_signals" USING btree ("topic_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_content_demand_signals_type" ON "content_demand_signals" USING btree ("signal_type");