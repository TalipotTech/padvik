CREATE TABLE "content_views" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "content_views_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"content_id" bigint NOT NULL,
	"user_id" bigint,
	"creator_id" bigint,
	"classroom_id" bigint,
	"watched_seconds" integer DEFAULT 0 NOT NULL,
	"completed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "classroom_members" ADD COLUMN "role" varchar(20) DEFAULT 'student' NOT NULL;--> statement-breakpoint
ALTER TABLE "classroom_members" ADD COLUMN "status" varchar(20) DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "classroom_members" ADD COLUMN "removed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "classrooms" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "classrooms" ADD COLUMN "academic_year" varchar(10);--> statement-breakpoint
ALTER TABLE "classrooms" ADD COLUMN "max_students" integer DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE "classrooms" ADD COLUMN "student_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "classrooms" ADD COLUMN "settings" jsonb DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "classrooms" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "creator_content" ADD COLUMN "slug" varchar(600);--> statement-breakpoint
ALTER TABLE "creator_content" ADD COLUMN "original_file_name" varchar(500);--> statement-breakpoint
ALTER TABLE "creator_content" ADD COLUMN "original_file_type" varchar(100);--> statement-breakpoint
ALTER TABLE "creator_content" ADD COLUMN "original_file_size_bytes" bigint;--> statement-breakpoint
ALTER TABLE "creator_content" ADD COLUMN "processed_url" text;--> statement-breakpoint
ALTER TABLE "creator_content" ADD COLUMN "ai_summary" text;--> statement-breakpoint
ALTER TABLE "creator_content" ADD COLUMN "ai_tags" text[] DEFAULT '{}';--> statement-breakpoint
ALTER TABLE "creator_content" ADD COLUMN "ai_transcript" text;--> statement-breakpoint
ALTER TABLE "creator_content" ADD COLUMN "ai_quality_score" numeric(3, 2);--> statement-breakpoint
ALTER TABLE "creator_content" ADD COLUMN "ai_language" varchar(10);--> statement-breakpoint
ALTER TABLE "creator_content" ADD COLUMN "upload_status" varchar(20) DEFAULT 'completed' NOT NULL;--> statement-breakpoint
ALTER TABLE "creator_content" ADD COLUMN "review_notes" text;--> statement-breakpoint
ALTER TABLE "creator_content" ADD COLUMN "doubt_count" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "creator_content" ADD COLUMN "total_watch_minutes" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "creator_content" ADD COLUMN "assigned_classrooms" bigint[] DEFAULT '{}';--> statement-breakpoint
ALTER TABLE "creator_profiles" ADD COLUMN "cover_image_url" text;--> statement-breakpoint
ALTER TABLE "creator_profiles" ADD COLUMN "verification_status" varchar(20) DEFAULT 'unverified' NOT NULL;--> statement-breakpoint
ALTER TABLE "creator_profiles" ADD COLUMN "total_views" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "creator_profiles" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "doubt_responses" ADD COLUMN "is_accepted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "doubts" ADD COLUMN "classroom_id" bigint;--> statement-breakpoint
ALTER TABLE "doubts" ADD COLUMN "is_public" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "content_views" ADD CONSTRAINT "content_views_content_id_creator_content_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."creator_content"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_views" ADD CONSTRAINT "content_views_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_views" ADD CONSTRAINT "content_views_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_content_views_content_user" ON "content_views" USING btree ("content_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_content_views_creator_student" ON "content_views" USING btree ("creator_id","user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_content_views_classroom" ON "content_views" USING btree ("classroom_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_content_views_user_recent" ON "content_views" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_classroom_members_student_status" ON "classroom_members" USING btree ("student_id","status");--> statement-breakpoint
CREATE INDEX "idx_classrooms_active" ON "classrooms" USING btree ("teacher_id","is_active");--> statement-breakpoint
CREATE INDEX "idx_creator_content_slug" ON "creator_content" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "idx_creator_content_upload_status" ON "creator_content" USING btree ("upload_status");--> statement-breakpoint
CREATE INDEX "idx_creator_profiles_verification" ON "creator_profiles" USING btree ("verification_status");--> statement-breakpoint
CREATE INDEX "idx_doubts_classroom_id" ON "doubts" USING btree ("classroom_id");