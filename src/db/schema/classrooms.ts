import {
  pgTable,
  bigint,
  varchar,
  text,
  boolean,
  integer,
  timestamp,
  jsonb,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { boards, standards, subjects } from "./curriculum";
import { exams } from "./exams";

export const classrooms = pgTable(
  "classrooms",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    teacherId: bigint("teacher_id", { mode: "number" })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    boardId: bigint("board_id", { mode: "number" }).references(() => boards.id, {
      onDelete: "set null",
    }),
    standardId: bigint("standard_id", { mode: "number" }).references(() => standards.id, {
      onDelete: "set null",
    }),
    subjectId: bigint("subject_id", { mode: "number" }).references(() => subjects.id, {
      onDelete: "set null",
    }),
    institution: varchar("institution", { length: 255 }),
    joinCode: varchar("join_code", { length: 10 }).notNull().unique(),
    isActive: boolean("is_active").notNull().default(true),
    metadata: jsonb("metadata").default({}),
    // --- Added in pipeline phase ---
    description: text("description"),
    academicYear: varchar("academic_year", { length: 10 }),
    maxStudents: integer("max_students").notNull().default(100),
    studentCount: integer("student_count").notNull().default(0),
    settings: jsonb("settings").default({}), // { allowDoubts, requireApproval, showLeaderboard }
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_classrooms_teacher_id").on(table.teacherId),
    index("idx_classrooms_active").on(table.teacherId, table.isActive),
  ]
);

export const classroomMembers = pgTable(
  "classroom_members",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    classroomId: bigint("classroom_id", { mode: "number" })
      .notNull()
      .references(() => classrooms.id, { onDelete: "cascade" }),
    studentId: bigint("student_id", { mode: "number" })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    // --- Added in pipeline phase ---
    role: varchar("role", { length: 20 }).notNull().default("student"), // student, monitor, assistant
    status: varchar("status", { length: 20 }).notNull().default("active"), // active, removed, left
    removedAt: timestamp("removed_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_classroom_members_classroom_id").on(table.classroomId),
    index("idx_classroom_members_student_id").on(table.studentId),
    index("idx_classroom_members_student_status").on(table.studentId, table.status),
    unique("uq_classroom_members_classroom_student").on(table.classroomId, table.studentId),
  ]
);

export const teacherAssessments = pgTable(
  "teacher_assessments",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    classroomId: bigint("classroom_id", { mode: "number" })
      .notNull()
      .references(() => classrooms.id, { onDelete: "cascade" }),
    examId: bigint("exam_id", { mode: "number" })
      .notNull()
      .references(() => exams.id, { onDelete: "cascade" }),
    assignedBy: bigint("assigned_by", { mode: "number" })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
    dueDate: timestamp("due_date", { withTimezone: true }),
    instructions: text("instructions"),
    isGraded: boolean("is_graded").notNull().default(false),
    metadata: jsonb("metadata").default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_teacher_assessments_classroom_id").on(table.classroomId)]
);

// ---------------------------------------------------------------------------
// Classroom Invites — track invitations sent via email/sms/whatsapp
// ---------------------------------------------------------------------------
export const classroomInvites = pgTable(
  "classroom_invites",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    classroomId: bigint("classroom_id", { mode: "number" })
      .notNull()
      .references(() => classrooms.id, { onDelete: "cascade" }),
    creatorId: bigint("creator_id", { mode: "number" })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    recipientName: varchar("recipient_name", { length: 255 }),
    recipientEmail: varchar("recipient_email", { length: 255 }),
    recipientPhone: varchar("recipient_phone", { length: 20 }),
    channel: varchar("channel", { length: 20 }).notNull(), // email, sms, whatsapp
    inviteToken: varchar("invite_token", { length: 64 }).notNull().unique(),
    status: varchar("status", { length: 20 }).notNull().default("pending"), // pending, sent, failed, accepted
    sentAt: timestamp("sent_at", { withTimezone: true }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedBy: bigint("accepted_by", { mode: "number" }).references(() => users.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    metadata: jsonb("metadata").default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_classroom_invites_classroom").on(table.classroomId),
    index("idx_classroom_invites_token").on(table.inviteToken),
    index("idx_classroom_invites_status").on(table.status),
  ]
);
