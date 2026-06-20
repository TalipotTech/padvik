ALTER TABLE "auto_content_jobs" DROP CONSTRAINT "uq_auto_content_jobs_topic_type";--> statement-breakpoint
ALTER TABLE "auto_content_jobs" ADD COLUMN "requested_model" varchar(50) DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "auto_content_jobs" ADD CONSTRAINT "uq_auto_content_jobs_topic_type_model" UNIQUE("topic_id","content_type","requested_model");