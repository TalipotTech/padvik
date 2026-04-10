import {
  pgTable,
  bigint,
  varchar,
  text,
  boolean,
  smallint,
  integer,
  decimal,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { boards } from "./curriculum";
import { creatorProfiles } from "./creators";

// ---------------------------------------------------------------------------
// Schools Directory
// ---------------------------------------------------------------------------
export const schools = pgTable(
  "schools",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    name: varchar("name", { length: 500 }).notNull(),
    slug: varchar("slug", { length: 500 }),

    // External IDs (a school may have multiple)
    udiseCode: varchar("udise_code", { length: 20 }),
    cbseAffiliationNo: varchar("cbse_affiliation_no", { length: 20 }),
    icseCode: varchar("icse_code", { length: 20 }),
    stateBoardCode: varchar("state_board_code", { length: 30 }),

    // Board affiliation
    boardId: bigint("board_id", { mode: "number" }).references(() => boards.id, {
      onDelete: "set null",
    }),
    boardCode: varchar("board_code", { length: 20 }),

    // Location
    address: text("address"),
    city: varchar("city", { length: 200 }),
    district: varchar("district", { length: 200 }),
    state: varchar("state", { length: 100 }),
    pincode: varchar("pincode", { length: 10 }),
    latitude: decimal("latitude", { precision: 10, scale: 7 }),
    longitude: decimal("longitude", { precision: 10, scale: 7 }),

    // School details
    managementType: varchar("management_type", { length: 30 }),
    schoolCategory: varchar("school_category", { length: 30 }),
    medium: text("medium").array().default([]),
    classesFrom: smallint("classes_from"),
    classesTo: smallint("classes_to"),
    genderType: varchar("gender_type", { length: 20 }),
    isResidential: boolean("is_residential").notNull().default(false),

    // Contact
    phone: varchar("phone", { length: 30 }),
    email: varchar("email", { length: 200 }),
    website: text("website"),
    principalName: varchar("principal_name", { length: 200 }),

    // Stats
    studentCount: integer("student_count"),
    teacherCount: integer("teacher_count"),
    nonTeachingCount: integer("non_teaching_count"),

    // Padvik integration
    creatorProfileId: bigint("creator_profile_id", { mode: "number" }).references(
      () => creatorProfiles.id,
      { onDelete: "set null" }
    ),
    isVerified: boolean("is_verified").notNull().default(false),
    isPartner: boolean("is_partner").notNull().default(false),
    partnerSince: timestamp("partner_since", { withTimezone: true }),

    // Data management
    source: varchar("source", { length: 30 }).notNull(),
    sourceUrl: text("source_url"),
    rawData: jsonb("raw_data").default({}),
    lastRefreshedAt: timestamp("last_refreshed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Partial unique indexes
    uniqueIndex("uq_schools_udise_code").on(table.udiseCode),
    uniqueIndex("uq_schools_cbse_aff_no").on(table.cbseAffiliationNo),
    // Composite indexes for search
    index("idx_schools_board_state_district").on(table.boardCode, table.state, table.district),
    index("idx_schools_state_district_partner").on(table.state, table.district, table.isPartner),
    index("idx_schools_district_classes").on(table.district, table.classesTo),
    index("idx_schools_source").on(table.source),
    index("idx_schools_slug").on(table.slug),
  ]
);
