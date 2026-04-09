import {
  pgTable,
  bigint,
  varchar,
  text,
  decimal,
  timestamp,
  jsonb,
  date,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { creatorContent } from "./creators";

// ---------------------------------------------------------------------------
// Subscriptions (stub for Razorpay integration — Phase C5)
// ---------------------------------------------------------------------------
export const subscriptions = pgTable(
  "subscriptions",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    plan: varchar("plan", { length: 20 }).notNull(), // free, plus, pro
    userType: varchar("user_type", { length: 20 }).notNull(), // student, creator
    razorpaySubId: varchar("razorpay_sub_id", { length: 100 }),
    status: varchar("status", { length: 20 }).notNull().default("active"), // active, cancelled, expired, past_due
    amountInr: decimal("amount_inr", { precision: 8, scale: 2 }),
    billingCycle: varchar("billing_cycle", { length: 10 }), // monthly, yearly
    currentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_subscriptions_user_id").on(table.userId),
    index("idx_subscriptions_status").on(table.status),
  ]
);

// ---------------------------------------------------------------------------
// Creator Earnings (stub for Phase C6)
// ---------------------------------------------------------------------------
export const creatorEarnings = pgTable(
  "creator_earnings",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    creatorId: bigint("creator_id", { mode: "number" })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    periodMonth: date("period_month").notNull(), // first of month
    totalViews: bigint("total_views", { mode: "number" }).notNull().default(0),
    totalMinutes: bigint("total_minutes", { mode: "number" }).notNull().default(0),
    subscriptionShare: decimal("subscription_share", { precision: 10, scale: 2 }).default("0.00"),
    directSales: decimal("direct_sales", { precision: 10, scale: 2 }).default("0.00"),
    grossEarnings: decimal("gross_earnings", { precision: 10, scale: 2 }).default("0.00"),
    platformFee: decimal("platform_fee", { precision: 10, scale: 2 }).default("0.00"), // 30%
    netEarnings: decimal("net_earnings", { precision: 10, scale: 2 }).default("0.00"), // 70%
    payoutStatus: varchar("payout_status", { length: 20 }).notNull().default("pending"),
    payoutRef: varchar("payout_ref", { length: 100 }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("uq_creator_earnings_period").on(table.creatorId, table.periodMonth),
    index("idx_creator_earnings_creator_id").on(table.creatorId),
  ]
);

// ---------------------------------------------------------------------------
// Content Purchases (stub for Phase C5/C6)
// ---------------------------------------------------------------------------
export const contentPurchases = pgTable(
  "content_purchases",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    studentId: bigint("student_id", { mode: "number" })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    contentId: bigint("content_id", { mode: "number" })
      .notNull()
      .references(() => creatorContent.id, { onDelete: "cascade" }),
    amountInr: decimal("amount_inr", { precision: 8, scale: 2 }).notNull(),
    razorpayPaymentId: varchar("razorpay_payment_id", { length: 100 }),
    status: varchar("status", { length: 20 }).notNull().default("completed"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_content_purchases_student_id").on(table.studentId),
    index("idx_content_purchases_content_id").on(table.contentId),
  ]
);
