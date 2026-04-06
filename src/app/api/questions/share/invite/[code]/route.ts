import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { questionShareInvites, questionShares } from "@/db/schema/questions";
import { eq } from "drizzle-orm";

// ---------------------------------------------------------------------------
// GET /api/questions/share/invite/[code] — View invite details
// ---------------------------------------------------------------------------
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Login required" } },
      { status: 401 }
    );
  }

  const { code } = await params;

  const [invite] = await db
    .select()
    .from(questionShareInvites)
    .where(eq(questionShareInvites.inviteCode, code))
    .limit(1);

  if (!invite) {
    return NextResponse.json(
      { success: false, error: { code: "NOT_FOUND", message: "Invite not found or expired" } },
      { status: 404 }
    );
  }

  // Check expiry
  if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) {
    return NextResponse.json(
      { success: false, error: { code: "EXPIRED", message: "This invite has expired" } },
      { status: 410 }
    );
  }

  // Check max uses
  if (invite.maxUses && invite.usedCount >= invite.maxUses) {
    return NextResponse.json(
      { success: false, error: { code: "MAX_USES", message: "This invite has reached its maximum uses" } },
      { status: 410 }
    );
  }

  return NextResponse.json({
    success: true,
    data: {
      questionCount: (invite.questionIds as number[]).length,
      permission: invite.permission,
      expiresAt: invite.expiresAt?.toISOString() ?? null,
      usesRemaining: invite.maxUses ? invite.maxUses - invite.usedCount : null,
    },
  });
}

// ---------------------------------------------------------------------------
// POST /api/questions/share/invite/[code] — Accept invite
// ---------------------------------------------------------------------------
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Login required" } },
      { status: 401 }
    );
  }

  const { code } = await params;
  const userId = Number(session.user.id);

  const [invite] = await db
    .select()
    .from(questionShareInvites)
    .where(eq(questionShareInvites.inviteCode, code))
    .limit(1);

  if (!invite) {
    return NextResponse.json(
      { success: false, error: { code: "NOT_FOUND", message: "Invite not found" } },
      { status: 404 }
    );
  }

  if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) {
    return NextResponse.json(
      { success: false, error: { code: "EXPIRED", message: "This invite has expired" } },
      { status: 410 }
    );
  }

  if (invite.maxUses && invite.usedCount >= invite.maxUses) {
    return NextResponse.json(
      { success: false, error: { code: "MAX_USES", message: "This invite has reached its maximum uses" } },
      { status: 410 }
    );
  }

  // Don't accept your own invite
  if (invite.createdBy === userId) {
    return NextResponse.json(
      { success: false, error: { code: "SELF_SHARE", message: "Cannot accept your own invite" } },
      { status: 400 }
    );
  }

  // Create share records for each question
  const questionIds = invite.questionIds as number[];
  const shareValues = questionIds.map((questionId) => ({
    questionId,
    sharedBy: invite.createdBy,
    sharedWith: userId,
    permission: invite.permission,
  }));

  const inserted = await db
    .insert(questionShares)
    .values(shareValues)
    .onConflictDoNothing()
    .returning({ id: questionShares.id });

  // Increment used count
  await db
    .update(questionShareInvites)
    .set({ usedCount: invite.usedCount + 1 })
    .where(eq(questionShareInvites.id, invite.id));

  return NextResponse.json({
    success: true,
    data: {
      questionsShared: inserted.length,
      permission: invite.permission,
    },
  });
}
