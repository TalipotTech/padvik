import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { questionShareInvites, questions } from "@/db/schema/questions";
import { eq, and, inArray } from "drizzle-orm";
import { z } from "zod/v4";
import { randomBytes } from "crypto";

// ---------------------------------------------------------------------------
// POST /api/questions/share/invite — Create a share invite link
// ---------------------------------------------------------------------------
const createInviteSchema = z.object({
  questionIds: z.array(z.number().int()).min(1).max(100),
  permission: z.enum(["read", "copy"]).default("read"),
  maxUses: z.number().int().min(1).max(100).optional(),
  expiresInHours: z.number().int().min(1).max(720).optional(), // max 30 days
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

  const parsed = createInviteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } },
      { status: 400 }
    );
  }

  const userId = Number(session.user.id);
  const { questionIds, permission, maxUses, expiresInHours } = parsed.data;

  // Verify ownership
  if (session.user.role !== "admin") {
    const owned = await db
      .select({ id: questions.id })
      .from(questions)
      .where(and(inArray(questions.id, questionIds), eq(questions.createdBy, userId)));

    if (owned.length !== questionIds.length) {
      return NextResponse.json(
        { success: false, error: { code: "FORBIDDEN", message: "You can only share questions you created" } },
        { status: 403 }
      );
    }
  }

  const inviteCode = randomBytes(32).toString("hex");
  const expiresAt = expiresInHours
    ? new Date(Date.now() + expiresInHours * 60 * 60 * 1000)
    : null;

  const [invite] = await db
    .insert(questionShareInvites)
    .values({
      inviteCode,
      createdBy: userId,
      questionIds,
      permission,
      maxUses: maxUses ?? null,
      expiresAt,
    })
    .returning();

  return NextResponse.json(
    {
      success: true,
      data: {
        inviteCode: invite.inviteCode,
        questionCount: questionIds.length,
        permission,
        maxUses: maxUses ?? null,
        expiresAt: expiresAt?.toISOString() ?? null,
      },
    },
    { status: 201 }
  );
}
