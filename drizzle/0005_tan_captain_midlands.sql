ALTER TABLE "user_notes" ADD COLUMN "note_type" varchar(20) DEFAULT 'typed' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_notes" ADD COLUMN "image_url" text;--> statement-breakpoint
ALTER TABLE "user_notes" ADD COLUMN "image_file_id" bigint;--> statement-breakpoint
ALTER TABLE "user_notes" ADD CONSTRAINT "user_notes_image_file_id_file_uploads_id_fk" FOREIGN KEY ("image_file_id") REFERENCES "public"."file_uploads"("id") ON DELETE set null ON UPDATE no action;