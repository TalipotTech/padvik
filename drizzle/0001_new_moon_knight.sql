CREATE TABLE "question_share_invites" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "question_share_invites_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"invite_code" varchar(64) NOT NULL,
	"created_by" bigint NOT NULL,
	"question_ids" bigint[] NOT NULL,
	"permission" varchar(10) DEFAULT 'read' NOT NULL,
	"max_uses" smallint,
	"used_count" smallint DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "question_share_invites_invite_code_unique" UNIQUE("invite_code")
);
--> statement-breakpoint
CREATE TABLE "question_shares" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "question_shares_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"question_id" bigint NOT NULL,
	"shared_by" bigint NOT NULL,
	"shared_with" bigint NOT NULL,
	"permission" varchar(10) DEFAULT 'read' NOT NULL,
	"shared_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	CONSTRAINT "uq_question_shares" UNIQUE("question_id","shared_by","shared_with")
);
--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "created_by" bigint;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "section_label" varchar(20);--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "question_number" varchar(20);--> statement-breakpoint
ALTER TABLE "question_share_invites" ADD CONSTRAINT "question_share_invites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_shares" ADD CONSTRAINT "question_shares_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_shares" ADD CONSTRAINT "question_shares_shared_by_users_id_fk" FOREIGN KEY ("shared_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_shares" ADD CONSTRAINT "question_shares_shared_with_users_id_fk" FOREIGN KEY ("shared_with") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_question_share_invites_code" ON "question_share_invites" USING btree ("invite_code");--> statement-breakpoint
CREATE INDEX "idx_question_shares_shared_with" ON "question_shares" USING btree ("shared_with");--> statement-breakpoint
CREATE INDEX "idx_question_shares_question_id" ON "question_shares" USING btree ("question_id");--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_questions_created_by" ON "questions" USING btree ("created_by");