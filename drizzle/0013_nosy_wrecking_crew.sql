CREATE TABLE "schools" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "schools_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" varchar(500) NOT NULL,
	"slug" varchar(500),
	"udise_code" varchar(20),
	"cbse_affiliation_no" varchar(20),
	"icse_code" varchar(20),
	"state_board_code" varchar(30),
	"board_id" bigint,
	"board_code" varchar(20),
	"address" text,
	"city" varchar(200),
	"district" varchar(200),
	"state" varchar(100),
	"pincode" varchar(10),
	"latitude" numeric(10, 7),
	"longitude" numeric(10, 7),
	"management_type" varchar(30),
	"school_category" varchar(30),
	"medium" text[] DEFAULT '{}',
	"classes_from" smallint,
	"classes_to" smallint,
	"gender_type" varchar(20),
	"is_residential" boolean DEFAULT false NOT NULL,
	"phone" varchar(30),
	"email" varchar(200),
	"website" text,
	"principal_name" varchar(200),
	"student_count" integer,
	"teacher_count" integer,
	"non_teaching_count" integer,
	"creator_profile_id" bigint,
	"is_verified" boolean DEFAULT false NOT NULL,
	"is_partner" boolean DEFAULT false NOT NULL,
	"partner_since" timestamp with time zone,
	"source" varchar(30) NOT NULL,
	"source_url" text,
	"raw_data" jsonb DEFAULT '{}'::jsonb,
	"last_refreshed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "schools" ADD CONSTRAINT "schools_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schools" ADD CONSTRAINT "schools_creator_profile_id_creator_profiles_id_fk" FOREIGN KEY ("creator_profile_id") REFERENCES "public"."creator_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_schools_udise_code" ON "schools" USING btree ("udise_code");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_schools_cbse_aff_no" ON "schools" USING btree ("cbse_affiliation_no");--> statement-breakpoint
CREATE INDEX "idx_schools_board_state_district" ON "schools" USING btree ("board_code","state","district");--> statement-breakpoint
CREATE INDEX "idx_schools_state_district_partner" ON "schools" USING btree ("state","district","is_partner");--> statement-breakpoint
CREATE INDEX "idx_schools_district_classes" ON "schools" USING btree ("district","classes_to");--> statement-breakpoint
CREATE INDEX "idx_schools_source" ON "schools" USING btree ("source");--> statement-breakpoint
CREATE INDEX "idx_schools_slug" ON "schools" USING btree ("slug");