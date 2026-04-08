CREATE TABLE "reading_progress" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "reading_progress_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" bigint NOT NULL,
	"content_item_id" bigint NOT NULL,
	"sections_read" jsonb DEFAULT '[]'::jsonb,
	"completion_percent" smallint DEFAULT 0 NOT NULL,
	"last_read_at" timestamp with time zone DEFAULT now() NOT NULL,
	"total_read_time_seconds" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_reading_progress_user_content" UNIQUE("user_id","content_item_id")
);
--> statement-breakpoint
CREATE TABLE "topic_conversations" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "topic_conversations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" bigint NOT NULL,
	"topic_id" bigint NOT NULL,
	"messages" jsonb DEFAULT '[]'::jsonb,
	"message_count" integer DEFAULT 0 NOT NULL,
	"ai_provider" varchar(30),
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"keyword" varchar(500),
	"saved_as_note" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_bookmarks" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "user_bookmarks_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" bigint NOT NULL,
	"topic_id" bigint NOT NULL,
	"content_item_id" bigint,
	"title" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_user_bookmarks_user_topic" UNIQUE("user_id","topic_id")
);
--> statement-breakpoint
CREATE TABLE "user_highlights" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "user_highlights_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" bigint NOT NULL,
	"content_item_id" bigint NOT NULL,
	"highlighted_text" text NOT NULL,
	"note" text,
	"color" varchar(20) DEFAULT 'yellow' NOT NULL,
	"start_offset" integer NOT NULL,
	"end_offset" integer NOT NULL,
	"section_id" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reading_progress" ADD CONSTRAINT "reading_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_progress" ADD CONSTRAINT "reading_progress_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_conversations" ADD CONSTRAINT "topic_conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_conversations" ADD CONSTRAINT "topic_conversations_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_bookmarks" ADD CONSTRAINT "user_bookmarks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_bookmarks" ADD CONSTRAINT "user_bookmarks_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_bookmarks" ADD CONSTRAINT "user_bookmarks_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_highlights" ADD CONSTRAINT "user_highlights_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_highlights" ADD CONSTRAINT "user_highlights_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_reading_progress_user" ON "reading_progress" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_topic_conversations_user" ON "topic_conversations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_topic_conversations_topic" ON "topic_conversations" USING btree ("topic_id");--> statement-breakpoint
CREATE INDEX "idx_user_bookmarks_user" ON "user_bookmarks" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_user_highlights_user" ON "user_highlights" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_user_highlights_content" ON "user_highlights" USING btree ("content_item_id");