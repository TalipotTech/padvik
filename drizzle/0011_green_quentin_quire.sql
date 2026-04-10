CREATE TABLE "classroom_invites" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "classroom_invites_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"classroom_id" bigint NOT NULL,
	"creator_id" bigint NOT NULL,
	"recipient_name" varchar(255),
	"recipient_email" varchar(255),
	"recipient_phone" varchar(20),
	"channel" varchar(20) NOT NULL,
	"invite_token" varchar(64) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"sent_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"accepted_by" bigint,
	"expires_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "classroom_invites_invite_token_unique" UNIQUE("invite_token")
);
--> statement-breakpoint
ALTER TABLE "classroom_invites" ADD CONSTRAINT "classroom_invites_classroom_id_classrooms_id_fk" FOREIGN KEY ("classroom_id") REFERENCES "public"."classrooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classroom_invites" ADD CONSTRAINT "classroom_invites_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classroom_invites" ADD CONSTRAINT "classroom_invites_accepted_by_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_classroom_invites_classroom" ON "classroom_invites" USING btree ("classroom_id");--> statement-breakpoint
CREATE INDEX "idx_classroom_invites_token" ON "classroom_invites" USING btree ("invite_token");--> statement-breakpoint
CREATE INDEX "idx_classroom_invites_status" ON "classroom_invites" USING btree ("status");