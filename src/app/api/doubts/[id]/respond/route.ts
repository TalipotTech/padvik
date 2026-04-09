import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { doubts, doubtResponses } from "@/db/schema/doubts";
import { eq } from "drizzle-orm";
import { z } from "zod/v4";

const respondSchema = z.object({
  responseText: z.string().min(1).max(10000),
  responseType: z.enum(["text", "audio", "video"]).optional(),
  mediaUrl: z.string().url().optional(),
});

// ---------------------------------------------------------------------------
// POST /api/doubts/[id]/respond — Post a response to a doubt
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

  if (isNaN(doubtId)) {
    return NextResponse.json(
      { success: false, error: { code: "VALIDATION_ERROR", message: "Invalid doubt ID" } },
      { status: 400 }
    );
  }

  // Check doubt exists
  const [doubt] = await db
    .select({ id: doubts.id, status: doubts.status })
    .from(doubts)
    .where(eq(doubts.id, doubtId))
    .limit(1);

  if (!doubt) {
    return NextResponse.json(
      { success: false, error: { code: "NOT_FOUND", message: "Doubt not found" } },
      { status: 404 }
    );
  }

  if (doubt.status === "closed") {
    return NextResponse.json(
      { success: false, error: { code: "CLOSED", message: "This doubt has been closed" } },
      { status: 400 }
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

  const parsed = respondSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } },
      { status: 400 }
    );
  }

  const { responseText, responseType, mediaUrl } = parsed.data;

  // Insert response and update doubt status
  const [response] = await db.transaction(async (tx) => {
    const result = await tx.insert(doubtResponses).values({
      doubtId,
      responderId: userId,
      responseText,
      responseType: responseType ?? "text",
      mediaUrl: mediaUrl ?? null,
    }).returning();

    // Auto-update status to "answered" on first response
    if (doubt.status === "open") {
      await tx
        .update(doubts)
        .set({ status: "answered", updatedAt: new Date() })
        .where(eq(doubts.id, doubtId));
    }

    return result;
  });

  return NextResponse.json({ success: true, data: response }, { status: 201 });
}
