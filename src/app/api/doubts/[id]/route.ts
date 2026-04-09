import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { users } from "@/db/schema/auth";
import { doubts, doubtResponses } from "@/db/schema/doubts";
import { eq, asc } from "drizzle-orm";
import { z } from "zod/v4";

// ---------------------------------------------------------------------------
// GET /api/doubts/[id] — Get doubt with responses
// ---------------------------------------------------------------------------
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const doubtId = Number(id);
  if (isNaN(doubtId)) {
    return NextResponse.json(
      { success: false, error: { code: "VALIDATION_ERROR", message: "Invalid doubt ID" } },
      { status: 400 }
    );
  }

  const [doubt] = await db
    .select({
      id: doubts.id,
      studentId: doubts.studentId,
      creatorId: doubts.creatorId,
      contentId: doubts.contentId,
      topicId: doubts.topicId,
      questionText: doubts.questionText,
      questionImages: doubts.questionImages,
      status: doubts.status,
      upvoteCount: doubts.upvoteCount,
      createdAt: doubts.createdAt,
      studentName: users.fullName,
      studentAvatar: users.avatarUrl,
    })
    .from(doubts)
    .innerJoin(users, eq(users.id, doubts.studentId))
    .where(eq(doubts.id, doubtId))
    .limit(1);

  if (!doubt) {
    return NextResponse.json(
      { success: false, error: { code: "NOT_FOUND", message: "Doubt not found" } },
      { status: 404 }
    );
  }

  // Fetch responses
  const responses = await db
    .select({
      id: doubtResponses.id,
      doubtId: doubtResponses.doubtId,
      responderId: doubtResponses.responderId,
      responseText: doubtResponses.responseText,
      responseType: doubtResponses.responseType,
      mediaUrl: doubtResponses.mediaUrl,
      isAi: doubtResponses.isAi,
      createdAt: doubtResponses.createdAt,
      responderName: users.fullName,
      responderAvatar: users.avatarUrl,
    })
    .from(doubtResponses)
    .innerJoin(users, eq(users.id, doubtResponses.responderId))
    .where(eq(doubtResponses.doubtId, doubtId))
    .orderBy(asc(doubtResponses.createdAt));

  return NextResponse.json({
    success: true,
    data: { ...doubt, responses },
  });
}

// ---------------------------------------------------------------------------
// PATCH /api/doubts/[id] — Update doubt status
// ---------------------------------------------------------------------------
const patchSchema = z.object({
  status: z.enum(["open", "answered", "closed"]),
});

export async function PATCH(
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

  const [existing] = await db
    .select({ studentId: doubts.studentId, creatorId: doubts.creatorId })
    .from(doubts)
    .where(eq(doubts.id, doubtId))
    .limit(1);

  if (!existing) {
    return NextResponse.json(
      { success: false, error: { code: "NOT_FOUND", message: "Doubt not found" } },
      { status: 404 }
    );
  }

  // Only the student who asked or the targeted creator can update status
  if (existing.studentId !== userId && existing.creatorId !== userId && session.user.role !== "admin") {
    return NextResponse.json(
      { success: false, error: { code: "FORBIDDEN", message: "Not authorized to update this doubt" } },
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

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } },
      { status: 400 }
    );
  }

  const [updated] = await db
    .update(doubts)
    .set({ status: parsed.data.status, updatedAt: new Date() })
    .where(eq(doubts.id, doubtId))
    .returning();

  return NextResponse.json({ success: true, data: updated });
}
