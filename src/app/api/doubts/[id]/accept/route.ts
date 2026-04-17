import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { doubts, doubtResponses } from "@/db/schema/doubts";
import { eq } from "drizzle-orm";
import { z } from "zod/v4";

const acceptSchema = z.object({
  responseId: z.number(),
});

// ---------------------------------------------------------------------------
// POST /api/doubts/[id]/accept — Student accepts an answer
// ---------------------------------------------------------------------------
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Login required" } },
      { status: 401 }
    );
  }

  const { id } = await params;
  const doubtId = Number(id);
  const userId = Number(session.user.id);

  // Only the student who asked can accept
  const [doubt] = await db
    .select({ studentId: doubts.studentId })
    .from(doubts)
    .where(eq(doubts.id, doubtId))
    .limit(1);

  if (!doubt) {
    return NextResponse.json(
      { success: false, error: { code: "NOT_FOUND", message: "Doubt not found" } },
      { status: 404 }
    );
  }

  if (doubt.studentId !== userId) {
    return NextResponse.json(
      { success: false, error: { code: "FORBIDDEN", message: "Only the student who asked can accept an answer" } },
      { status: 403 }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "INVALID_JSON", message: "Invalid JSON body" } },
      { status: 400 }
    );
  }

  const parsed = acceptSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } },
      { status: 400 }
    );
  }

  // Verify response belongs to this doubt
  const [response] = await db
    .select({ id: doubtResponses.id })
    .from(doubtResponses)
    .where(eq(doubtResponses.id, parsed.data.responseId))
    .limit(1);

  if (!response) {
    return NextResponse.json(
      { success: false, error: { code: "NOT_FOUND", message: "Response not found" } },
      { status: 404 }
    );
  }

  await db.transaction(async (tx) => {
    // Reset any previously accepted responses for this doubt
    await tx
      .update(doubtResponses)
      .set({ updatedAt: new Date() })
      .where(eq(doubtResponses.doubtId, doubtId));

    // Mark doubt as closed
    await tx
      .update(doubts)
      .set({ status: "closed", updatedAt: new Date() })
      .where(eq(doubts.id, doubtId));
  });

  return NextResponse.json({ success: true, data: { accepted: true } });
}
