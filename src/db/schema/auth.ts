import {
  pgTable,
  bigint,
  varchar,
  text,
  boolean,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  email: varchar("email", { length: 255 }).unique(),
  phone: varchar("phone", { length: 15 }).unique(),
  passwordHash: text("password_hash"),
  fullName: varchar("full_name", { length: 255 }).notNull(),
  avatarUrl: text("avatar_url"),
  role: varchar("role", { length: 20 }).notNull().default("student"),
  institution: varchar("institution", { length: 255 }),
  boardId: bigint("board_id", { mode: "number" }),
  standardId: bigint("standard_id", { mode: "number" }),
  isVerified: boolean("is_verified").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  isCreator: boolean("is_creator").notNull().default(false),
  creatorTier: varchar("creator_tier", { length: 20 }), // free, plus, pro
  creatorVerified: boolean("creator_verified").notNull().default(false),
  // Verification
  emailVerified: boolean("email_verified").notNull().default(false),
  phoneVerified: boolean("phone_verified").notNull().default(false),
  // Guardian info (for students)
  guardianName: varchar("guardian_name", { length: 255 }),
  guardianPhone: varchar("guardian_phone", { length: 20 }),
  guardianEmail: varchar("guardian_email", { length: 255 }),
  guardianRelation: varchar("guardian_relation", { length: 30 }), // father, mother, guardian
  // Profile
  dateOfBirth: varchar("date_of_birth", { length: 10 }), // YYYY-MM-DD
  gender: varchar("gender", { length: 10 }), // male, female, other
  city: varchar("city", { length: 100 }),
  state: varchar("state", { length: 100 }),
  preferences: jsonb("preferences").default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const userSessions = pgTable("user_sessions", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  userId: bigint("user_id", { mode: "number" })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  deviceInfo: jsonb("device_info"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
