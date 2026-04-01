import {
  pgTable,
  bigint,
  varchar,
  text,
  boolean,
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_classrooms_teacher_id").on(table.teacherId)]
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
  },
  (table) => [
    index("idx_classroom_members_classroom_id").on(table.classroomId),
    index("idx_classroom_members_student_id").on(table.studentId),
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
