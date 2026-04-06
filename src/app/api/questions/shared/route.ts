import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { questionShares, questions } from "@/db/schema/questions";
import { users } from "@/db/schema/auth";
import { eq, and, desc, sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// GET /api/questions/shared — List questions shared with the current user
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Login required" } },
      { status: 401 }
    );
  }

  const userId = Number(session.user.id);
  if (isNaN(userId)) {
    return NextResponse.json(
      { success: true, data: { items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } } }
    );
  }
  const page = Number(request.nextUrl.searchParams.get("page") ?? "1");
  const limit = Math.min(Number(request.nextUrl.searchParams.get("limit") ?? "20"), 100);
  const offset = (page - 1) * limit;

  const nowIso = new Date().toISOString();

  // Get shares where not expired
  const rows = await db
    .select({
      share: questionShares,
      question: questions,
      sharedByName: users.fullName,
      sharedByEmail: users.email,
    })
    .from(questionShares)
    .innerJoin(questions, eq(questionShares.questionId, questions.id))
    .innerJoin(users, eq(questionShares.sharedBy, users.id))
    .where(
      and(
        eq(questionShares.sharedWith, userId),
        sql`(${questionShares.expiresAt} IS NULL OR ${questionShares.expiresAt} > ${nowIso}::timestamptz)`
      )
    )
    .orderBy(desc(questionShares.sharedAt))
    .limit(limit)
    .offset(offset);

  const [countResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(questionShares)
    .where(
      and(
        eq(questionShares.sharedWith, userId),
        sql`(${questionShares.expiresAt} IS NULL OR ${questionShares.expiresAt} > ${nowIso}::timestamptz)`
      )
    );

  return NextResponse.json({
    success: true,
    data: {
      items: rows.map((r) => ({
        shareId: r.share.id,
        permission: r.share.permission,
        sharedAt: r.share.sharedAt,
        sharedBy: { name: r.sharedByName, email: r.sharedByEmail },
        question: r.question,
      })),
      pagination: {
        page,
        limit,
        total: countResult?.count ?? 0,
        totalPages: Math.ceil((countResult?.count ?? 0) / limit),
      },
    },
  });
}
