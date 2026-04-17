CREATE TABLE "creator_content" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "creator_content_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"creator_id" bigint NOT NULL,
	"content_type" varchar(30) NOT NULL,
	"title" varchar(500) NOT NULL,
	"description" text,
	"body" text,
	"file_upload_id" bigint,
	"media_url" text,
	"thumbnail_url" text,
	"duration_seconds" integer,
	"board_id" bigint,
	"standard_id" bigint,
	"subject_id" bigint,
	"chapter_id" bigint,
	"topic_id" bigint,
	"is_premium" boolean DEFAULT false NOT NULL,
	"price" numeric(8, 2),
	"language" varchar(10) DEFAULT 'en' NOT NULL,
	"view_count" bigint DEFAULT 0 NOT NULL,
	"like_count" bigint DEFAULT 0 NOT NULL,
	"share_count" bigint DEFAULT 0 NOT NULL,
	"avg_rating" numeric(3, 2) DEFAULT '0.00',
	"review_status" varchar(20) DEFAULT 'pending' NOT NULL,
	"is_published" boolean DEFAULT false NOT NULL,
	"published_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "creator_followers" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "creator_followers_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"creator_id" bigint NOT NULL,
	"student_id" bigint NOT NULL,
	"followed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_creator_followers_pair" UNIQUE("creator_id","student_id")
);
--> statement-breakpoint
CREATE TABLE "creator_profiles" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "creator_profiles_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" bigint NOT NULL,
	"display_name" varchar(255) NOT NULL,
	"bio" text,
	"institution" varchar(255),
	"institution_type" varchar(30),
	"boards" text[] DEFAULT '{}',
	"subjects" text[] DEFAULT '{}',
	"classes_from" smallint,
	"classes_to" smallint,
	"website_url" text,
	"social_links" jsonb DEFAULT '{}'::jsonb,
	"rating" numeric(3, 2) DEFAULT '0.00',
	"follower_count" bigint DEFAULT 0 NOT NULL,
	"content_count" bigint DEFAULT 0 NOT NULL,
	"is_featured" boolean DEFAULT false NOT NULL,
	"payout_upi" varchar(100),
	"payout_bank" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_creator_profiles_user_id" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "doubt_responses" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "doubt_responses_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"doubt_id" bigint NOT NULL,
	"responder_id" bigint NOT NULL,
	"response_text" text NOT NULL,
	"response_type" varchar(20) DEFAULT 'text' NOT NULL,
	"media_url" text,
	"is_ai" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "doubts" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "doubts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"student_id" bigint NOT NULL,
	"creator_id" bigint,
	"content_id" bigint,
	"topic_id" bigint,
	"question_text" text NOT NULL,
	"question_images" jsonb DEFAULT '[]'::jsonb,
	"status" varchar(20) DEFAULT 'open' NOT NULL,
	"upvote_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_purchases" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "content_purchases_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"student_id" bigint NOT NULL,
	"content_id" bigint NOT NULL,
	"amount_inr" numeric(8, 2) NOT NULL,
	"razorpay_payment_id" varchar(100),
	"status" varchar(20) DEFAULT 'completed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "creator_earnings" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "creator_earnings_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"creator_id" bigint NOT NULL,
	"period_month" date NOT NULL,
	"total_views" bigint DEFAULT 0 NOT NULL,
	"total_minutes" bigint DEFAULT 0 NOT NULL,
	"subscription_share" numeric(10, 2) DEFAULT '0.00',
	"direct_sales" numeric(10, 2) DEFAULT '0.00',
	"gross_earnings" numeric(10, 2) DEFAULT '0.00',
	"platform_fee" numeric(10, 2) DEFAULT '0.00',
	"net_earnings" numeric(10, 2) DEFAULT '0.00',
	"payout_status" varchar(20) DEFAULT 'pending' NOT NULL,
	"payout_ref" varchar(100),
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_creator_earnings_period" UNIQUE("creator_id","period_month")
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "subscriptions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" bigint NOT NULL,
	"plan" varchar(20) NOT NULL,
	"user_type" varchar(20) NOT NULL,
	"razorpay_sub_id" varchar(100),
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"amount_inr" numeric(8, 2),
	"billing_cycle" varchar(10),
	"current_period_start" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_creator" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "creator_tier" varchar(20);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "creator_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "creator_content" ADD CONSTRAINT "creator_content_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_content" ADD CONSTRAINT "creator_content_file_upload_id_file_uploads_id_fk" FOREIGN KEY ("file_upload_id") REFERENCES "public"."file_uploads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_content" ADD CONSTRAINT "creator_content_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_content" ADD CONSTRAINT "creator_content_standard_id_standards_id_fk" FOREIGN KEY ("standard_id") REFERENCES "public"."standards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_content" ADD CONSTRAINT "creator_content_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_content" ADD CONSTRAINT "creator_content_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_content" ADD CONSTRAINT "creator_content_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_followers" ADD CONSTRAINT "creator_followers_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_followers" ADD CONSTRAINT "creator_followers_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_profiles" ADD CONSTRAINT "creator_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doubt_responses" ADD CONSTRAINT "doubt_responses_doubt_id_doubts_id_fk" FOREIGN KEY ("doubt_id") REFERENCES "public"."doubts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doubt_responses" ADD CONSTRAINT "doubt_responses_responder_id_users_id_fk" FOREIGN KEY ("responder_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doubts" ADD CONSTRAINT "doubts_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doubts" ADD CONSTRAINT "doubts_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doubts" ADD CONSTRAINT "doubts_content_id_creator_content_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."creator_content"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doubts" ADD CONSTRAINT "doubts_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_purchases" ADD CONSTRAINT "content_purchases_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_purchases" ADD CONSTRAINT "content_purchases_content_id_creator_content_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."creator_content"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_earnings" ADD CONSTRAINT "creator_earnings_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_creator_content_creator_id" ON "creator_content" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "idx_creator_content_topic_id" ON "creator_content" USING btree ("topic_id");--> statement-breakpoint
CREATE INDEX "idx_creator_content_review_status" ON "creator_content" USING btree ("review_status");--> statement-breakpoint
CREATE INDEX "idx_creator_content_board_id" ON "creator_content" USING btree ("board_id");--> statement-breakpoint
CREATE INDEX "idx_creator_followers_creator_id" ON "creator_followers" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "idx_creator_followers_student_id" ON "creator_followers" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "idx_creator_profiles_user_id" ON "creator_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_doubt_responses_doubt_id" ON "doubt_responses" USING btree ("doubt_id");--> statement-breakpoint
CREATE INDEX "idx_doubt_responses_responder_id" ON "doubt_responses" USING btree ("responder_id");--> statement-breakpoint
CREATE INDEX "idx_doubts_student_id" ON "doubts" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "idx_doubts_creator_id" ON "doubts" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "idx_doubts_topic_id" ON "doubts" USING btree ("topic_id");--> statement-breakpoint
CREATE INDEX "idx_doubts_status" ON "doubts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_content_purchases_student_id" ON "content_purchases" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "idx_content_purchases_content_id" ON "content_purchases" USING btree ("content_id");--> statement-breakpoint
CREATE INDEX "idx_creator_earnings_creator_id" ON "creator_earnings" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "idx_subscriptions_user_id" ON "subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_subscriptions_status" ON "subscriptions" USING btree ("status");