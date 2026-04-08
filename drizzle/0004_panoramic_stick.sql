CREATE TABLE "topic_understanding" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "topic_understanding_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" bigint NOT NULL,
	"topic_id" bigint NOT NULL,
	"understanding_level" varchar(10) DEFAULT 'green' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_topic_understanding_user_topic" UNIQUE("user_id","topic_id")
);
--> statement-breakpoint
CREATE TABLE "user_videos" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "user_videos_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" bigint NOT NULL,
	"topic_id" bigint NOT NULL,
	"youtube_url" text NOT NULL,
	"title" varchar(500),
	"thumbnail_url" text,
	"duration_seconds" integer,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "topic_understanding" ADD CONSTRAINT "topic_understanding_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_understanding" ADD CONSTRAINT "topic_understanding_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_videos" ADD CONSTRAINT "user_videos_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_videos" ADD CONSTRAINT "user_videos_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_topic_understanding_user" ON "topic_understanding" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_user_videos_user_topic" ON "user_videos" USING btree ("user_id","topic_id");