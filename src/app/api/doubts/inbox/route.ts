import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema/auth";
import { doubts } from "@/db/schema/doubts";
import { classrooms } from "@/db/schema/classrooms";
import { creatorContent } from "@/db/schema/creators";
import { eq, and, desc, sql, or, inArray } from "drizzle-orm";
import { z } from "zod/v4";
import { checkCreator } from "@/lib/check-creator";

const querySchema = z.object({
  status: z.string().optional(),
  classroomId: z.coerce.number().optional(),
  contentId: z.coerce.number().optional(),
  topicId: z.coerce.number().optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(50).default(20),
});

// ---------------------------------------------------------------------------
// GET /api/doubts/inbox — Creator's doubt inbox
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest) {
  const creator = await checkCreator();
  if (!creator) {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Login required" } },
      { status: 401 }
    );
  }

  if (!creator.isCreator) {
    return NextResponse.json(
      { success: false, error: { code: "FORBIDDEN", message: "Creator account required" } },
      { status: 403 }
    );
  }

  const userId = creator.userId;
  const params = Object.fromEntries(request.nextUrl.searchParams);
  const parsed = querySchema.safeParse(params);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } },
      { status: 400 }
    );
  }

  const { status, classroomId, contentId, topicId, page, limit } = parsed.data;
  const offset = (page - 1) * limit;

  // Get creator's classroom IDs and content IDs for broader matching
  const myClassrooms = await db.select({ id: classrooms.id }).from(classrooms).where(eq(classrooms.teacherId, userId));
  const myClassroomIds = myClassrooms.map(c => c.id);

  // Show doubts: targeted at this creator OR from their classrooms OR on their content
  const creatorConditions = [eq(doubts.creatorId, userId)];
  if (myClassroomIds.length > 0) {
    creatorConditions.push(inArray(doubts.classroomId, myClassroomIds));
  }

  const conditions = [or(...creatorConditions)!];
  if (status) conditions.push(eq(doubts.status, status));
  if (classroomId) conditions.push(eq(doubts.classroomId, classroomId));
  if (contentId) conditions.push(eq(doubts.contentId, contentId));
  if (topicId) conditions.push(eq(doubts.topicId, topicId));

  const whereClause = and(...conditions);

  const [items, countResult] = await Promise.all([
    db
      .select({
        id: doubts.id,
        studentId: doubts.studentId,
        creatorId: doubts.creatorId,
        contentId: doubts.contentId,
        topicId: doubts.topicId,
        questionText: doubts.questionText,
        status: doubts.status,
        upvoteCount: doubts.upvoteCount,
        createdAt: doubts.createdAt,
        studentName: users.fullName,
        studentAvatar: users.avatarUrl,
      })
      .from(doubts)
      .innerJoin(users, eq(users.id, doubts.studentId))
      .where(whereClause)
      .orderBy(desc(doubts.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(doubts)
      .where(whereClause),
  ]);

  const total = countResult[0]?.count ?? 0;

  return NextResponse.json({
    success: true,
    data: {
      items,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    },
  });
}
