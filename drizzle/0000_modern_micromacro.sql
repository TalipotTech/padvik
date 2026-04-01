CREATE TABLE "user_sessions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "user_sessions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" bigint NOT NULL,
	"token_hash" text NOT NULL,
	"device_info" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "users_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"email" varchar(255),
	"phone" varchar(15),
	"password_hash" text,
	"full_name" varchar(255) NOT NULL,
	"avatar_url" text,
	"role" varchar(20) DEFAULT 'student' NOT NULL,
	"institution" varchar(255),
	"board_id" bigint,
	"standard_id" bigint,
	"is_verified" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"preferences" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_phone_unique" UNIQUE("phone")
);
--> statement-breakpoint
CREATE TABLE "boards" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "boards_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"code" varchar(20) NOT NULL,
	"name" varchar(255) NOT NULL,
	"full_name" text,
	"state" varchar(100),
	"website_url" text,
	"syllabus_url" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "boards_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "chapters" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "chapters_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"subject_id" bigint NOT NULL,
	"chapter_number" smallint NOT NULL,
	"title" varchar(500) NOT NULL,
	"title_local" varchar(500),
	"description" text,
	"textbook_ref" varchar(255),
	"estimated_hours" numeric(4, 1),
	"weightage_pct" numeric(5, 2),
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"sort_order" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_chapters_subject_number" UNIQUE("subject_id","chapter_number")
);
--> statement-breakpoint
CREATE TABLE "standards" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "standards_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"board_id" bigint NOT NULL,
	"grade" smallint NOT NULL,
	"stream" varchar(50),
	"academic_year" varchar(10) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_standards_board_grade_stream_year" UNIQUE("board_id","grade","stream","academic_year")
);
--> statement-breakpoint
CREATE TABLE "subjects" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "subjects_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"standard_id" bigint NOT NULL,
	"code" varchar(50) NOT NULL,
	"name" varchar(255) NOT NULL,
	"name_local" varchar(255),
	"subject_type" varchar(20) DEFAULT 'theory' NOT NULL,
	"is_elective" boolean DEFAULT false NOT NULL,
	"max_marks" smallint,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_subjects_standard_code" UNIQUE("standard_id","code")
);
--> statement-breakpoint
CREATE TABLE "topic_mappings" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "topic_mappings_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"source_topic_id" bigint NOT NULL,
	"target_topic_id" bigint NOT NULL,
	"similarity_score" numeric(3, 2),
	"mapping_type" varchar(20) DEFAULT 'equivalent' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topics" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "topics_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"chapter_id" bigint NOT NULL,
	"title" varchar(500) NOT NULL,
	"title_local" varchar(500),
	"description" text,
	"learning_objectives" jsonb DEFAULT '[]'::jsonb,
	"bloom_level" varchar(20),
	"estimated_minutes" smallint,
	"sort_order" smallint NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_items" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "content_items_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"topic_id" bigint NOT NULL,
	"content_type" varchar(30) NOT NULL,
	"title" varchar(500) NOT NULL,
	"body" text NOT NULL,
	"body_format" varchar(10) DEFAULT 'markdown' NOT NULL,
	"source_type" varchar(30) NOT NULL,
	"source_url" text,
	"uploaded_by" bigint,
	"language" varchar(10) DEFAULT 'en' NOT NULL,
	"quality_score" numeric(3, 2) DEFAULT '0.00',
	"review_status" varchar(20) DEFAULT 'pending' NOT NULL,
	"reviewed_by" bigint,
	"view_count" bigint DEFAULT 0 NOT NULL,
	"upvote_count" integer DEFAULT 0 NOT NULL,
	"is_published" boolean DEFAULT false NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "file_uploads" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "file_uploads_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" bigint,
	"file_name" varchar(500) NOT NULL,
	"file_type" varchar(20) NOT NULL,
	"file_size_bytes" bigint,
	"storage_key" text NOT NULL,
	"storage_url" text NOT NULL,
	"processing_status" varchar(20) DEFAULT 'uploaded' NOT NULL,
	"extracted_text" text,
	"extracted_content_ids" bigint[],
	"upload_context" varchar(30),
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_notes" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "user_notes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" bigint NOT NULL,
	"topic_id" bigint,
	"content_item_id" bigint,
	"title" varchar(500),
	"body" text NOT NULL,
	"body_format" varchar(10) DEFAULT 'markdown' NOT NULL,
	"is_private" boolean DEFAULT true NOT NULL,
	"tags" text[] DEFAULT '{}',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "question_papers" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "question_papers_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"board_id" bigint,
	"standard_id" bigint,
	"subject_id" bigint,
	"paper_title" varchar(500) NOT NULL,
	"paper_year" smallint NOT NULL,
	"paper_month" varchar(20),
	"paper_type" varchar(30) NOT NULL,
	"total_marks" smallint,
	"duration_minutes" smallint,
	"file_upload_id" bigint,
	"source_url" text,
	"parsing_status" varchar(20) DEFAULT 'pending' NOT NULL,
	"parsed_by" varchar(30),
	"question_count" smallint DEFAULT 0 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "questions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "questions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"topic_id" bigint NOT NULL,
	"question_type" varchar(30) NOT NULL,
	"difficulty" varchar(10) NOT NULL,
	"bloom_level" varchar(20),
	"question_text" text NOT NULL,
	"question_html" text,
	"question_images" jsonb DEFAULT '[]'::jsonb,
	"options" jsonb,
	"correct_answer" text,
	"solution" text,
	"solution_html" text,
	"marks" numeric(4, 1) DEFAULT '1.0' NOT NULL,
	"negative_marks" numeric(4, 1) DEFAULT '0.0' NOT NULL,
	"time_seconds" smallint,
	"source_type" varchar(30) NOT NULL,
	"source_ref" varchar(255),
	"source_year" smallint,
	"source_paper_id" bigint,
	"language" varchar(10) DEFAULT 'en' NOT NULL,
	"is_verified" boolean DEFAULT false NOT NULL,
	"verified_by" bigint,
	"usage_count" bigint DEFAULT 0 NOT NULL,
	"avg_accuracy" numeric(5, 2),
	"tags" text[] DEFAULT '{}',
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exam_attempts" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "exam_attempts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"exam_id" bigint NOT NULL,
	"user_id" bigint NOT NULL,
	"attempt_number" smallint DEFAULT 1 NOT NULL,
	"status" varchar(20) DEFAULT 'started' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"time_spent_seconds" integer,
	"total_score" numeric(6, 1),
	"max_score" numeric(6, 1),
	"percentage" numeric(5, 2),
	"grade" varchar(5),
	"evaluation_mode" varchar(20) DEFAULT 'auto' NOT NULL,
	"evaluated_by" bigint,
	"evaluated_at" timestamp with time zone,
	"feedback" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exam_questions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "exam_questions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"exam_id" bigint NOT NULL,
	"question_id" bigint NOT NULL,
	"sort_order" smallint NOT NULL,
	"section_label" varchar(50),
	"marks_override" numeric(4, 1),
	"is_compulsory" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exam_responses" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "exam_responses_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"attempt_id" bigint NOT NULL,
	"question_id" bigint NOT NULL,
	"response_text" text,
	"selected_option_ids" jsonb,
	"response_images" jsonb DEFAULT '[]'::jsonb,
	"is_correct" boolean,
	"marks_obtained" numeric(4, 1),
	"time_spent_seconds" integer,
	"ai_evaluation" jsonb,
	"teacher_evaluation" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exams" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "exams_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"title" varchar(500) NOT NULL,
	"description" text,
	"exam_type" varchar(30) NOT NULL,
	"created_by" bigint NOT NULL,
	"subject_id" bigint,
	"chapter_ids" bigint[] DEFAULT '{}',
	"topic_ids" bigint[] DEFAULT '{}',
	"generation_mode" varchar(20) NOT NULL,
	"total_marks" numeric(6, 1) NOT NULL,
	"duration_minutes" smallint NOT NULL,
	"negative_marking" boolean DEFAULT false NOT NULL,
	"negative_pct" numeric(4, 2) DEFAULT '0' NOT NULL,
	"passing_pct" numeric(5, 2) DEFAULT '35.00' NOT NULL,
	"difficulty_mix" jsonb DEFAULT '{"easy":30,"medium":50,"hard":20}'::jsonb,
	"question_type_mix" jsonb,
	"is_published" boolean DEFAULT false NOT NULL,
	"is_timed" boolean DEFAULT true NOT NULL,
	"allow_review" boolean DEFAULT true NOT NULL,
	"shuffle_questions" boolean DEFAULT true NOT NULL,
	"shuffle_options" boolean DEFAULT true NOT NULL,
	"max_attempts" smallint DEFAULT 1 NOT NULL,
	"available_from" timestamp with time zone,
	"available_until" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learning_sessions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "learning_sessions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" bigint NOT NULL,
	"session_type" varchar(30) NOT NULL,
	"subject_id" bigint,
	"chapter_id" bigint,
	"topic_id" bigint,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"duration_minutes" integer,
	"pages_read" smallint,
	"questions_attempted" smallint,
	"questions_correct" smallint,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "performance_reports" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "performance_reports_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" bigint NOT NULL,
	"report_type" varchar(30) NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"subject_id" bigint,
	"summary" jsonb NOT NULL,
	"recommendations" jsonb DEFAULT '[]'::jsonb,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "student_progress" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "student_progress_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" bigint NOT NULL,
	"topic_id" bigint NOT NULL,
	"mastery_level" numeric(3, 2) DEFAULT '0.00' NOT NULL,
	"confidence" numeric(3, 2) DEFAULT '0.00' NOT NULL,
	"total_questions_attempted" integer DEFAULT 0 NOT NULL,
	"correct_answers" integer DEFAULT 0 NOT NULL,
	"time_spent_minutes" integer DEFAULT 0 NOT NULL,
	"last_studied_at" timestamp with time zone,
	"next_review_at" timestamp with time zone,
	"streak_days" smallint DEFAULT 0 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_student_progress_user_topic" UNIQUE("user_id","topic_id")
);
--> statement-breakpoint
CREATE TABLE "classroom_members" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "classroom_members_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"classroom_id" bigint NOT NULL,
	"student_id" bigint NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_classroom_members_classroom_student" UNIQUE("classroom_id","student_id")
);
--> statement-breakpoint
CREATE TABLE "classrooms" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "classrooms_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"teacher_id" bigint NOT NULL,
	"name" varchar(255) NOT NULL,
	"board_id" bigint,
	"standard_id" bigint,
	"subject_id" bigint,
	"institution" varchar(255),
	"join_code" varchar(10) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "classrooms_join_code_unique" UNIQUE("join_code")
);
--> statement-breakpoint
CREATE TABLE "teacher_assessments" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "teacher_assessments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"classroom_id" bigint NOT NULL,
	"exam_id" bigint NOT NULL,
	"assigned_by" bigint NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"due_date" timestamp with time zone,
	"instructions" text,
	"is_graded" boolean DEFAULT false NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "conversations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" bigint NOT NULL,
	"title" varchar(500),
	"context_type" varchar(30),
	"topic_id" bigint,
	"subject_id" bigint,
	"model_used" varchar(50),
	"message_count" smallint DEFAULT 0 NOT NULL,
	"token_count" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "messages_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"conversation_id" bigint NOT NULL,
	"role" varchar(10) NOT NULL,
	"content" text NOT NULL,
	"content_type" varchar(20) DEFAULT 'text' NOT NULL,
	"attachments" jsonb DEFAULT '[]'::jsonb,
	"token_count" integer,
	"model_used" varchar(50),
	"cost_usd" numeric(8, 6),
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_pipeline_logs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "content_pipeline_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"pipeline_stage" varchar(30) NOT NULL,
	"entity_type" varchar(30) NOT NULL,
	"entity_id" bigint NOT NULL,
	"status" varchar(20) NOT NULL,
	"input_data" jsonb,
	"output_data" jsonb,
	"processing_time_ms" integer,
	"ai_model_used" varchar(50),
	"ai_tokens_used" integer,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scrape_jobs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "scrape_jobs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"job_type" varchar(30) NOT NULL,
	"source_url" text NOT NULL,
	"board_id" bigint,
	"standard_id" bigint,
	"status" varchar(20) DEFAULT 'queued' NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"items_found" integer DEFAULT 0 NOT NULL,
	"items_processed" integer DEFAULT 0 NOT NULL,
	"error_log" text,
	"retry_count" smallint DEFAULT 0 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_config" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "system_config_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"config_key" varchar(100) NOT NULL,
	"config_value" jsonb NOT NULL,
	"description" text,
	"updated_by" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "system_config_config_key_unique" UNIQUE("config_key")
);
--> statement-breakpoint
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standards" ADD CONSTRAINT "standards_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_standard_id_standards_id_fk" FOREIGN KEY ("standard_id") REFERENCES "public"."standards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_mappings" ADD CONSTRAINT "topic_mappings_source_topic_id_topics_id_fk" FOREIGN KEY ("source_topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_mappings" ADD CONSTRAINT "topic_mappings_target_topic_id_topics_id_fk" FOREIGN KEY ("target_topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topics" ADD CONSTRAINT "topics_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_uploads" ADD CONSTRAINT "file_uploads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_notes" ADD CONSTRAINT "user_notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_notes" ADD CONSTRAINT "user_notes_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_notes" ADD CONSTRAINT "user_notes_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_papers" ADD CONSTRAINT "question_papers_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_papers" ADD CONSTRAINT "question_papers_standard_id_standards_id_fk" FOREIGN KEY ("standard_id") REFERENCES "public"."standards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_papers" ADD CONSTRAINT "question_papers_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_papers" ADD CONSTRAINT "question_papers_file_upload_id_file_uploads_id_fk" FOREIGN KEY ("file_upload_id") REFERENCES "public"."file_uploads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_source_paper_id_question_papers_id_fk" FOREIGN KEY ("source_paper_id") REFERENCES "public"."question_papers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_attempts" ADD CONSTRAINT "exam_attempts_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_attempts" ADD CONSTRAINT "exam_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_attempts" ADD CONSTRAINT "exam_attempts_evaluated_by_users_id_fk" FOREIGN KEY ("evaluated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_questions" ADD CONSTRAINT "exam_questions_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_questions" ADD CONSTRAINT "exam_questions_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_responses" ADD CONSTRAINT "exam_responses_attempt_id_exam_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."exam_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_responses" ADD CONSTRAINT "exam_responses_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exams" ADD CONSTRAINT "exams_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exams" ADD CONSTRAINT "exams_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_sessions" ADD CONSTRAINT "learning_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_sessions" ADD CONSTRAINT "learning_sessions_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_sessions" ADD CONSTRAINT "learning_sessions_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_sessions" ADD CONSTRAINT "learning_sessions_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_reports" ADD CONSTRAINT "performance_reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_reports" ADD CONSTRAINT "performance_reports_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_progress" ADD CONSTRAINT "student_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_progress" ADD CONSTRAINT "student_progress_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classroom_members" ADD CONSTRAINT "classroom_members_classroom_id_classrooms_id_fk" FOREIGN KEY ("classroom_id") REFERENCES "public"."classrooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classroom_members" ADD CONSTRAINT "classroom_members_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classrooms" ADD CONSTRAINT "classrooms_teacher_id_users_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classrooms" ADD CONSTRAINT "classrooms_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classrooms" ADD CONSTRAINT "classrooms_standard_id_standards_id_fk" FOREIGN KEY ("standard_id") REFERENCES "public"."standards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classrooms" ADD CONSTRAINT "classrooms_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_assessments" ADD CONSTRAINT "teacher_assessments_classroom_id_classrooms_id_fk" FOREIGN KEY ("classroom_id") REFERENCES "public"."classrooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_assessments" ADD CONSTRAINT "teacher_assessments_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_assessments" ADD CONSTRAINT "teacher_assessments_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scrape_jobs" ADD CONSTRAINT "scrape_jobs_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scrape_jobs" ADD CONSTRAINT "scrape_jobs_standard_id_standards_id_fk" FOREIGN KEY ("standard_id") REFERENCES "public"."standards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_config" ADD CONSTRAINT "system_config_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_chapters_subject_id" ON "chapters" USING btree ("subject_id");--> statement-breakpoint
CREATE INDEX "idx_standards_board_id" ON "standards" USING btree ("board_id");--> statement-breakpoint
CREATE INDEX "idx_subjects_standard_id" ON "subjects" USING btree ("standard_id");--> statement-breakpoint
CREATE INDEX "idx_topic_mappings_source" ON "topic_mappings" USING btree ("source_topic_id");--> statement-breakpoint
CREATE INDEX "idx_topic_mappings_target" ON "topic_mappings" USING btree ("target_topic_id");--> statement-breakpoint
CREATE INDEX "idx_topics_chapter_id" ON "topics" USING btree ("chapter_id");--> statement-breakpoint
CREATE INDEX "idx_content_items_topic_id" ON "content_items" USING btree ("topic_id");--> statement-breakpoint
CREATE INDEX "idx_content_items_review_status" ON "content_items" USING btree ("review_status");--> statement-breakpoint
CREATE INDEX "idx_file_uploads_user_id" ON "file_uploads" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_user_notes_user_id" ON "user_notes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_user_notes_topic_id" ON "user_notes" USING btree ("topic_id");--> statement-breakpoint
CREATE INDEX "idx_question_papers_board_year" ON "question_papers" USING btree ("board_id","paper_year");--> statement-breakpoint
CREATE INDEX "idx_questions_topic_id" ON "questions" USING btree ("topic_id");--> statement-breakpoint
CREATE INDEX "idx_questions_source_type" ON "questions" USING btree ("source_type");--> statement-breakpoint
CREATE INDEX "idx_questions_difficulty" ON "questions" USING btree ("difficulty");--> statement-breakpoint
CREATE INDEX "idx_exam_attempts_exam_id" ON "exam_attempts" USING btree ("exam_id");--> statement-breakpoint
CREATE INDEX "idx_exam_attempts_user_id" ON "exam_attempts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_exam_questions_exam_id" ON "exam_questions" USING btree ("exam_id");--> statement-breakpoint
CREATE INDEX "idx_exam_responses_attempt_id" ON "exam_responses" USING btree ("attempt_id");--> statement-breakpoint
CREATE INDEX "idx_exams_created_by" ON "exams" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "idx_learning_sessions_user_id" ON "learning_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_performance_reports_user_id" ON "performance_reports" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_student_progress_user_id" ON "student_progress" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_student_progress_topic_id" ON "student_progress" USING btree ("topic_id");--> statement-breakpoint
CREATE INDEX "idx_classroom_members_classroom_id" ON "classroom_members" USING btree ("classroom_id");--> statement-breakpoint
CREATE INDEX "idx_classroom_members_student_id" ON "classroom_members" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "idx_classrooms_teacher_id" ON "classrooms" USING btree ("teacher_id");--> statement-breakpoint
CREATE INDEX "idx_teacher_assessments_classroom_id" ON "teacher_assessments" USING btree ("classroom_id");--> statement-breakpoint
CREATE INDEX "idx_conversations_user_id" ON "conversations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_messages_conversation_id" ON "messages" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "idx_pipeline_logs_stage" ON "content_pipeline_logs" USING btree ("pipeline_stage");--> statement-breakpoint
CREATE INDEX "idx_pipeline_logs_entity" ON "content_pipeline_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "idx_scrape_jobs_status" ON "scrape_jobs" USING btree ("status");