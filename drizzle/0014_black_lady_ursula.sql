CREATE TABLE "student_explainer_progress" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "student_explainer_progress_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"student_id" bigint NOT NULL,
	"topic_id" bigint NOT NULL,
	"deck_id" bigint,
	"current_card" smallint DEFAULT 1 NOT NULL,
	"current_level" smallint DEFAULT 2 NOT NULL,
	"cards_completed" smallint DEFAULT 0 NOT NULL,
	"re_explanations" smallint DEFAULT 0 NOT NULL,
	"questions_asked" smallint DEFAULT 0 NOT NULL,
	"level_dropped" boolean DEFAULT false NOT NULL,
	"level_raised" boolean DEFAULT false NOT NULL,
	"completed" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp with time zone,
	"time_spent_secs" integer DEFAULT 0 NOT NULL,
	"approaches_used" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"extra_cards" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_explainer_progress_student_topic" UNIQUE("student_id","topic_id")
);
--> statement-breakpoint
CREATE TABLE "topic_explainer_decks" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "topic_explainer_decks_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"topic_id" bigint NOT NULL,
	"board_id" bigint,
	"standard_id" bigint,
	"subject_id" bigint,
	"level" smallint NOT NULL,
	"cards_json" jsonb NOT NULL,
	"card_count" smallint,
	"total_read_time" integer,
	"language" varchar(10) DEFAULT 'en' NOT NULL,
	"generation_model" varchar(50),
	"generation_cost" numeric(6, 4),
	"quality_score" numeric(3, 2),
	"view_count" bigint DEFAULT 0 NOT NULL,
	"avg_completion" numeric(3, 2) DEFAULT '0.00' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_explainer_decks_topic_level_lang" UNIQUE("topic_id","level","language")
);
--> statement-breakpoint
ALTER TABLE "student_explainer_progress" ADD CONSTRAINT "student_explainer_progress_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_explainer_progress" ADD CONSTRAINT "student_explainer_progress_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_explainer_progress" ADD CONSTRAINT "student_explainer_progress_deck_id_topic_explainer_decks_id_fk" FOREIGN KEY ("deck_id") REFERENCES "public"."topic_explainer_decks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_explainer_decks" ADD CONSTRAINT "topic_explainer_decks_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_explainer_decks" ADD CONSTRAINT "topic_explainer_decks_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_explainer_decks" ADD CONSTRAINT "topic_explainer_decks_standard_id_standards_id_fk" FOREIGN KEY ("standard_id") REFERENCES "public"."standards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_explainer_decks" ADD CONSTRAINT "topic_explainer_decks_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_explainer_progress_student_completed" ON "student_explainer_progress" USING btree ("student_id","completed");--> statement-breakpoint
CREATE INDEX "idx_explainer_progress_topic_completed" ON "student_explainer_progress" USING btree ("topic_id","completed");--> statement-breakpoint
CREATE INDEX "idx_explainer_decks_topic_level_lang" ON "topic_explainer_decks" USING btree ("topic_id","level","language");--> statement-breakpoint
CREATE INDEX "idx_explainer_decks_subject_standard_level" ON "topic_explainer_decks" USING btree ("subject_id","standard_id","level");