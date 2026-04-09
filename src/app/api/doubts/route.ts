import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { users } from "@/db/schema/auth";
import { doubts } from "@/db/schema/doubts";
import { eq, and, desc, sql, ilike } from "drizzle-orm";
import { z } from "zod/v4";

// ---------------------------------------------------------------------------
// POST /api/doubts — Student creates a doubt
// ---------------------------------------------------------------------------
const createSchema = z.object({
  questionText: z.string().min(10).max(5000),
  creatorId: z.number().optional(),
  contentId: z.number().optional(),
  topicId: z.number().optional(),
  questionImages: z.array(z.string()).optional(),
});

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Login required" } },
      { status: 401 }
    );
  }

  const userId = Number(session.user.id);

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "INVALID_JSON", message: "Invalid JSON body" } },
      { status: 400 }
    );
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } },
      { status: 400 }
    );
  }

  const { questionText, creatorId, contentId, topicId, questionImages } = parsed.data;

  const [doubt] = await db.insert(doubts).values({
    studentId: userId,
    creatorId: creatorId ?? null,
    contentId: contentId ?? null,
    topicId: topicId ?? null,
    questionText,
    questionImages: questionImages ?? [],
  }).returning();

  return NextResponse.json({ success: true, data: doubt }, { status: 201 });
}

// ---------------------------------------------------------------------------
// GET /api/doubts — List doubts with filters
// ---------------------------------------------------------------------------
const querySchema = z.object({
  status: z.string().optional(),
  creatorId: z.coerce.number().optional(),
  topicId: z.coerce.number().optional(),
  mine: z.enum(["true", "false"]).optional(), // show only my doubts
  search: z.string().optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(50).default(20),
});

export async function GET(request: NextRequest) {
  const session = await auth();
  const userId = session ? Number(session.user.id) : null;

  const params = Object.fromEntries(request.nextUrl.searchParams);
  const parsed = querySchema.safeParse(params);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } },
      { status: 400 }
    );
  }

  const { status, creatorId, topicId, mine, search, page, limit } = parsed.data;
  const offset = (page - 1) * limit;

  const conditions = [];
  if (status) conditions.push(eq(doubts.status, status));
  if (creatorId) conditions.push(eq(doubts.creatorId, creatorId));
  if (topicId) conditions.push(eq(doubts.topicId, topicId));
  if (mine === "true" && userId) conditions.push(eq(doubts.studentId, userId));
  if (search) conditions.push(ilike(doubts.questionText, `%${search}%`));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [items, countResult] = await Promise.all([
    db
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
