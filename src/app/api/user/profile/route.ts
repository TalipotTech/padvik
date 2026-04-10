import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { users } from "@/db/schema/auth";
import { standards, boards } from "@/db/schema/curriculum";
import { eq, and } from "drizzle-orm";
import { z } from "zod/v4";

const DEV_BYPASS = process.env.NODE_ENV === "development" && process.env.SKIP_AUTH === "true";

async function getUserId(): Promise<number | null> {
  try {
    const session = await auth();
    if (session?.user?.id) return Number(session.user.id);
  } catch { /* auth failed */ }
  if (DEV_BYPASS) return 1;
  return null;
}

/**
 * GET /api/user/profile — Get full user profile
 */
export async function GET() {
  const userId = await getUserId();
  if (!userId) {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Login required" } },
      { status: 401 }
    );
  }

  const [user] = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      email: users.email,
      phone: users.phone,
      avatarUrl: users.avatarUrl,
      role: users.role,
      institution: users.institution,
      boardId: users.boardId,
      standardId: users.standardId,
      isVerified: users.isVerified,
      emailVerified: users.emailVerified,
      phoneVerified: users.phoneVerified,
      guardianName: users.guardianName,
      guardianPhone: users.guardianPhone,
      guardianEmail: users.guardianEmail,
      guardianRelation: users.guardianRelation,
      dateOfBirth: users.dateOfBirth,
      gender: users.gender,
      city: users.city,
      state: users.state,
      isCreator: users.isCreator,
      preferences: users.preferences,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) {
    return NextResponse.json(
      { success: false, error: { code: "NOT_FOUND", message: "User not found" } },
      { status: 404 }
    );
  }

  // Resolve grade from standardId
  let grade: number | null = null;
  let boardCode: string | null = null;
  let boardName: string | null = null;

  if (user.standardId) {
    const [std] = await db
      .select({ grade: standards.grade, boardCode: boards.code, boardName: boards.name })
      .from(standards)
      .innerJoin(boards, eq(boards.id, standards.boardId))
      .where(eq(standards.id, user.standardId))
      .limit(1);
    if (std) {
      grade = std.grade;
      boardCode = std.boardCode;
      boardName = std.boardName;
    }
  }

  return NextResponse.json({
    success: true,
    data: { ...user, grade, boardCode, boardName },
  });
}

/**
 * PATCH /api/user/profile — Update user profile
 */
const PatchSchema = z.object({
  fullName: z.string().min(1).max(255).optional(),
  phone: z.string().min(8).max(20).optional().nullable(),
  institution: z.string().max(255).optional().nullable(),
  boardId: z.number().int().positive().optional(),
  grade: z.number().int().min(1).max(12).optional(),
  avatarUrl: z.string().optional().nullable(),
  dateOfBirth: z.string().max(10).optional().nullable(),
  gender: z.enum(["male", "female", "other"]).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  state: z.string().max(100).optional().nullable(),
  // Guardian fields
  guardianName: z.string().max(255).optional().nullable(),
  guardianPhone: z.string().max(20).optional().nullable(),
  guardianEmail: z.string().email().optional().nullable(),
  guardianRelation: z.enum(["father", "mother", "guardian", "other"]).optional().nullable(),
});

export async function PATCH(request: NextRequest) {
  const userId = await getUserId();
  if (!userId) {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Login required" } },
      { status: 401 }
    );
  }

  let body;
  try { body = await request.json(); } catch {
    return NextResponse.json({ success: false, error: { code: "INVALID_JSON", message: "Invalid JSON" } }, { status: 400 });
  }

  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } },
      { status: 400 }
    );
  }

  const { boardId, grade, ...rest } = parsed.data;
  const updates: Record<string, unknown> = { updatedAt: new Date() };

  // Copy all non-undefined fields
  for (const [key, value] of Object.entries(rest)) {
    if (value !== undefined) {
      updates[key] = value;
    }
  }

  if (boardId !== undefined) {
    updates.boardId = boardId;
  }

  // Look up standardId from boardId + grade
  if (boardId !== undefined && grade !== undefined) {
    const [std] = await db
      .select({ id: standards.id })
      .from(standards)
      .where(and(eq(standards.boardId, boardId), eq(standards.grade, grade)))
      .limit(1);
    if (std) {
      updates.standardId = std.id;
    }
  }

  await db.update(users).set(updates).where(eq(users.id, userId));

  return NextResponse.json({ success: true });
}
