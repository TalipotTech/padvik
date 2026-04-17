import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { users } from "@/db/schema/auth";
import { doubts } from "@/db/schema/doubts";
import { creatorContent } from "@/db/schema/creators";
import { eq, and, desc, sql } from "drizzle-orm";
import { z } from "zod/v4";

const querySchema = z.object({
  status: z.string().optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(50).default(20),
});

// GET /api/my/doubts — Student's asked doubts
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Login required" } }, { status: 401 });

  const userId = Number(session.user.id);
  const params = Object.fromEntries(request.nextUrl.searchParams);
  const parsed = querySchema.safeParse(params);
  if (!parsed.success) return NextResponse.json({ success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } }, { status: 400 });

  const { status, page, limit } = parsed.data;
  const offset = (page - 1) * limit;

  const conditions = [eq(doubts.studentId, userId)];
  if (status) conditions.push(eq(doubts.status, status));

  const [items, countResult] = await Promise.all([
    db.select({
      id: doubts.id,
      questionText: doubts.questionText,
      status: doubts.status,
      upvoteCount: doubts.upvoteCount,
      classroomId: doubts.classroomId,
      contentId: doubts.contentId,
      createdAt: doubts.createdAt,
      creatorName: users.fullName,
    })
      .from(doubts)
      .leftJoin(users, eq(users.id, doubts.creatorId))
      .where(and(...conditions))
      .orderBy(desc(doubts.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ count: sql<number>`count(*)::int` }).from(doubts).where(and(...conditions)),
  ]);

  return NextResponse.json({
    success: true,
    data: { items, pagination: { page, limit, total: countResult[0]?.count ?? 0, totalPages: Math.ceil((countResult[0]?.count ?? 0) / limit) } },
  });
}
