CREATE TABLE "board_notifications" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "board_notifications_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"board_id" bigint NOT NULL,
	"title" varchar(1000) NOT NULL,
	"slug" varchar(500),
	"category" varchar(30) NOT NULL,
	"summary" text,
	"source_url" text NOT NULL,
	"pdf_url" text,
	"affected_classes" smallint[] DEFAULT '{}',
	"affected_subjects" text[] DEFAULT '{}',
	"priority" varchar(10) DEFAULT 'medium' NOT NULL,
	"is_breaking" boolean DEFAULT false NOT NULL,
	"published_at" date NOT NULL,
	"scraped_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ai_processed" boolean DEFAULT false NOT NULL,
	"raw_html" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_board_notifications_source_url" UNIQUE("source_url")
);
--> statement-breakpoint
ALTER TABLE "board_notifications" ADD CONSTRAINT "board_notifications_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_board_notifications_board_published" ON "board_notifications" USING btree ("board_id","published_at");--> statement-breakpoint
CREATE INDEX "idx_board_notifications_category_published" ON "board_notifications" USING btree ("category","published_at");