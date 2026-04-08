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
 * GET /api/user/profile — Get user profile including saved board/grade
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
      role: users.role,
      boardId: users.boardId,
      standardId: users.standardId,
      preferences: users.preferences,
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
    data: {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      boardId: user.boardId,
      standardId: user.standardId,
      grade,
      boardCode,
      boardName,
    },
  });
}

/**
 * PATCH /api/user/profile — Update user profile (board/grade selection)
 */
const PatchSchema = z.object({
  boardId: z.number().int().positive().optional(),
  grade: z.number().int().min(1).max(12).optional(),
  fullName: z.string().min(1).max(255).optional(),
});

export async function PATCH(request: NextRequest) {
  const userId = await getUserId();
  if (!userId) {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Login required" } },
      { status: 401 }
    );
  }

  const body = await request.json();
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.message } },
      { status: 400 }
    );
  }

  const { boardId, grade, fullName } = parsed.data;
  const updates: Record<string, unknown> = { updatedAt: new Date() };

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

  if (fullName !== undefined) {
    updates.fullName = fullName;
  }

  await db.update(users).set(updates).where(eq(users.id, userId));

  return NextResponse.json({ success: true });
}
