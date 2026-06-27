CREATE TABLE "learning_path_assessments" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "learning_path_assessments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" bigint NOT NULL,
	"board_id" bigint,
	"grade" smallint,
	"subject_id" bigint,
	"signals_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"summary" text,
	"strengths_json" jsonb DEFAULT '[]'::jsonb,
	"improvements_json" jsonb DEFAULT '[]'::jsonb,
	"overall_score" numeric(4, 2),
	"generation_model" varchar(50),
	"generation_cost" numeric(8, 4),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topic_search_history" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "topic_search_history_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" bigint NOT NULL,
	"query" varchar(500) NOT NULL,
	"matched_topic_id" bigint,
	"board_id" bigint,
	"grade" smallint,
	"result_count" integer DEFAULT 0 NOT NULL,
	"was_rejected" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "learning_path_assessments" ADD CONSTRAINT "learning_path_assessments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_path_assessments" ADD CONSTRAINT "learning_path_assessments_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_path_assessments" ADD CONSTRAINT "learning_path_assessments_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_search_history" ADD CONSTRAINT "topic_search_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_search_history" ADD CONSTRAINT "topic_search_history_matched_topic_id_topics_id_fk" FOREIGN KEY ("matched_topic_id") REFERENCES "public"."topics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_search_history" ADD CONSTRAINT "topic_search_history_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_learning_path_assessments_user_subject_created" ON "learning_path_assessments" USING btree ("user_id","subject_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_topic_search_history_user_created" ON "topic_search_history" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_topic_search_history_matched_topic" ON "topic_search_history" USING btree ("matched_topic_id");