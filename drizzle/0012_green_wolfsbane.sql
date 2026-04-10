ALTER TABLE "users" ADD COLUMN "email_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "phone_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "guardian_name" varchar(255);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "guardian_phone" varchar(20);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "guardian_email" varchar(255);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "guardian_relation" varchar(30);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "date_of_birth" varchar(10);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "gender" varchar(10);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "city" varchar(100);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "state" varchar(100);