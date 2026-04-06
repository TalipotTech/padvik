import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { questionShares, questions } from "@/db/schema/questions";
import { eq, and, inArray } from "drizzle-orm";
import { z } from "zod/v4";

// ---------------------------------------------------------------------------
// POST /api/questions/share — Share questions with specific users
// ---------------------------------------------------------------------------
const shareSchema = z.object({
  questionIds: z.array(z.number().int()).min(1).max(100),
  sharedWithUserIds: z.array(z.number().int()).min(1).max(50),
  permission: z.enum(["read", "copy"]).default("read"),
  expiresAt: z.string().datetime().optional(),
});

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Login required" } },
      { status: 401 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "INVALID_JSON", message: "Invalid JSON body" } },
      { status: 400 }
    );
  }

  const parsed = shareSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } },
      { status: 400 }
    );
  }

  const userId = Number(session.user.id);
  const { questionIds, sharedWithUserIds, permission, expiresAt } = parsed.data;

  // Verify the user owns these questions (or is admin)
  if (session.user.role !== "admin") {
    const ownedQuestions = await db
      .select({ id: questions.id })
      .from(questions)
      .where(and(inArray(questions.id, questionIds), eq(questions.createdBy, userId)));

    if (ownedQuestions.length !== questionIds.length) {
      return NextResponse.json(
        { success: false, error: { code: "FORBIDDEN", message: "You can only share questions you created" } },
        { status: 403 }
      );
    }
  }

  // Build share records
  const shareValues = [];
  for (const questionId of questionIds) {
    for (const targetUserId of sharedWithUserIds) {
      if (targetUserId === userId) continue; // Don't share with yourself
      shareValues.push({
        questionId,
        sharedBy: userId,
        sharedWith: targetUserId,
        permission,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      });
    }
  }

  if (shareValues.length === 0) {
    return NextResponse.json(
      { success: false, error: { code: "NO_SHARES", message: "No valid shares to create" } },
      { status: 400 }
    );
  }

  // Insert with conflict handling (upsert permission if already shared)
  const inserted = await db
    .insert(questionShares)
    .values(shareValues)
    .onConflictDoNothing()
    .returning({ id: questionShares.id });

  return NextResponse.json(
    { success: true, data: { shared: inserted.length } },
    { status: 201 }
  );
}

// ---------------------------------------------------------------------------
// DELETE /api/questions/share — Remove shares
// ---------------------------------------------------------------------------
const unshareSchema = z.object({
  questionIds: z.array(z.number().int()).min(1),
  sharedWithUserId: z.number().int(),
});

export async function DELETE(request: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Login required" } },
      { status: 401 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "INVALID_JSON", message: "Invalid JSON body" } },
      { status: 400 }
    );
  }

  const parsed = unshareSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } },
      { status: 400 }
    );
  }

  const userId = Number(session.user.id);

  for (const questionId of parsed.data.questionIds) {
    await db
      .delete(questionShares)
      .where(
        and(
          eq(questionShares.questionId, questionId),
          eq(questionShares.sharedBy, userId),
          eq(questionShares.sharedWith, parsed.data.sharedWithUserId)
        )
      );
  }

  return NextResponse.json({ success: true, data: { removed: true } });
}
