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
  unique,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { fileUploads } from "./content";
import { boards, standards, subjects, chapters, topics } from "./curriculum";

// ---------------------------------------------------------------------------
// Creator Profiles
// ---------------------------------------------------------------------------
export const creatorProfiles = pgTable(
  "creator_profiles",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    displayName: varchar("display_name", { length: 255 }).notNull(),
    bio: text("bio"),
    institution: varchar("institution", { length: 255 }),
    institutionType: varchar("institution_type", { length: 30 }), // school, tuition, independent, publisher
    boards: text("boards").array().default([]),
    subjects: text("subjects").array().default([]),
    classesFrom: smallint("classes_from"),
    classesTo: smallint("classes_to"),
    websiteUrl: text("website_url"),
    socialLinks: jsonb("social_links").default({}),
    rating: decimal("rating", { precision: 3, scale: 2 }).default("0.00"),
    followerCount: bigint("follower_count", { mode: "number" }).notNull().default(0),
    contentCount: bigint("content_count", { mode: "number" }).notNull().default(0),
    isFeatured: boolean("is_featured").notNull().default(false),
    payoutUpi: varchar("payout_upi", { length: 100 }),
    payoutBank: jsonb("payout_bank"), // {account, ifsc, name}
    // --- Added in pipeline phase ---
    coverImageUrl: text("cover_image_url"),
    verificationStatus: varchar("verification_status", { length: 20 }).notNull().default("unverified"),
    totalViews: bigint("total_views", { mode: "number" }).notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("uq_creator_profiles_user_id").on(table.userId),
    index("idx_creator_profiles_user_id").on(table.userId),
    index("idx_creator_profiles_verification").on(table.verificationStatus),
  ]
);

// ---------------------------------------------------------------------------
// Creator Content
// ---------------------------------------------------------------------------
export const creatorContent = pgTable(
  "creator_content",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    creatorId: bigint("creator_id", { mode: "number" })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    contentType: varchar("content_type", { length: 30 }).notNull(), // video, audio, note, document, question_set, image, live_session
    title: varchar("title", { length: 500 }).notNull(),
    description: text("description"),
    body: text("body"), // for text/note content
    fileUploadId: bigint("file_upload_id", { mode: "number" }).references(
      () => fileUploads.id,
      { onDelete: "set null" }
    ),
    mediaUrl: text("media_url"), // processed media (HLS/CDN URL)
    thumbnailUrl: text("thumbnail_url"),
    durationSeconds: integer("duration_seconds"), // for video/audio
    boardId: bigint("board_id", { mode: "number" }).references(() => boards.id, {
      onDelete: "set null",
    }),
    standardId: bigint("standard_id", { mode: "number" }).references(() => standards.id, {
      onDelete: "set null",
    }),
    subjectId: bigint("subject_id", { mode: "number" }).references(() => subjects.id, {
      onDelete: "set null",
    }),
    chapterId: bigint("chapter_id", { mode: "number" }).references(() => chapters.id, {
      onDelete: "set null",
    }),
    topicId: bigint("topic_id", { mode: "number" }).references(() => topics.id, {
      onDelete: "set null",
    }),
    isPremium: boolean("is_premium").notNull().default(false),
    price: decimal("price", { precision: 8, scale: 2 }), // individual purchase price (INR)
    language: varchar("language", { length: 10 }).notNull().default("en"),
    viewCount: bigint("view_count", { mode: "number" }).notNull().default(0),
    likeCount: bigint("like_count", { mode: "number" }).notNull().default(0),
    shareCount: bigint("share_count", { mode: "number" }).notNull().default(0),
    avgRating: decimal("avg_rating", { precision: 3, scale: 2 }).default("0.00"),
    reviewStatus: varchar("review_status", { length: 20 }).notNull().default("pending"), // pending, approved, rejected
    isPublished: boolean("is_published").notNull().default(false),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    metadata: jsonb("metadata").default({}),
    // --- Added in pipeline phase ---
    slug: varchar("slug", { length: 600 }),
    originalFileName: varchar("original_file_name", { length: 500 }),
    originalFileType: varchar("original_file_type", { length: 100 }),
    originalFileSizeBytes: bigint("original_file_size_bytes", { mode: "number" }),
    processedUrl: text("processed_url"),
    aiSummary: text("ai_summary"),
    aiTags: text("ai_tags").array().default([]),
    aiTranscript: text("ai_transcript"),
    aiQualityScore: decimal("ai_quality_score", { precision: 3, scale: 2 }),
    aiLanguage: varchar("ai_language", { length: 10 }),
    uploadStatus: varchar("upload_status", { length: 20 }).notNull().default("completed"),
    reviewNotes: text("review_notes"),
    doubtCount: bigint("doubt_count", { mode: "number" }).notNull().default(0),
    totalWatchMinutes: bigint("total_watch_minutes", { mode: "number" }).notNull().default(0),
    assignedClassrooms: bigint("assigned_classrooms", { mode: "number" }).array().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_creator_content_creator_id").on(table.creatorId),
    index("idx_creator_content_topic_id").on(table.topicId),
    index("idx_creator_content_review_status").on(table.reviewStatus),
    index("idx_creator_content_board_id").on(table.boardId),
    index("idx_creator_content_slug").on(table.slug),
    index("idx_creator_content_upload_status").on(table.uploadStatus),
  ]
);

// ---------------------------------------------------------------------------
// Creator Followers
// ---------------------------------------------------------------------------
export const creatorFollowers = pgTable(
  "creator_followers",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    creatorId: bigint("creator_id", { mode: "number" })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    studentId: bigint("student_id", { mode: "number" })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    followedAt: timestamp("followed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("uq_creator_followers_pair").on(table.creatorId, table.studentId),
    index("idx_creator_followers_creator_id").on(table.creatorId),
    index("idx_creator_followers_student_id").on(table.studentId),
  ]
);

// ---------------------------------------------------------------------------
// Content Views — tracks per-user per-content engagement
// ---------------------------------------------------------------------------
export const contentViews = pgTable(
  "content_views",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    contentId: bigint("content_id", { mode: "number" })
      .notNull()
      .references(() => creatorContent.id, { onDelete: "cascade" }),
    userId: bigint("user_id", { mode: "number" }).references(() => users.id, {
      onDelete: "set null",
    }),
    creatorId: bigint("creator_id", { mode: "number" }).references(() => users.id, {
      onDelete: "set null",
    }),
    classroomId: bigint("classroom_id", { mode: "number" }), // nullable — null = organic view
    watchedSeconds: integer("watched_seconds").notNull().default(0),
    completed: boolean("completed").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_content_views_content_user").on(table.contentId, table.userId),
    index("idx_content_views_creator_student").on(table.creatorId, table.userId, table.createdAt),
    index("idx_content_views_classroom").on(table.classroomId, table.userId),
    index("idx_content_views_user_recent").on(table.userId, table.createdAt),
  ]
);
