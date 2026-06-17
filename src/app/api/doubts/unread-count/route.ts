import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { doubts } from "@/db/schema/doubts";
import { users } from "@/db/schema/auth";
import { eq, and, or, sql } from "drizzle-orm";

/**
 * GET /api/doubts/unread-count — Get count of unanswered doubts
 * For creators: doubts targeted at them with status "open"
 * For students: doubts they asked with new responses (status changed from what they last saw)
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: true, data: { count: 0 } });
  }

  // session.user.id is typed as string but is sometimes populated with a
  // non-numeric demo value (DEV_BYPASS / NextAuth credential providers).
  // All of our user.id columns are BIGINT, so a NaN here would produce a
  // Postgres "invalid input syntax for type bigint" error on every hit.
  // Treat a non-numeric id as "no count to report" — same outcome as an
  // unauthenticated visitor.
  const userId = Number(session.user.id);
  if (!Number.isFinite(userId)) {
    return NextResponse.json({ success: true, data: { count: 0 } });
  }

  // Check if user is a creator
  const [user] = await db.select({ isCreator: users.isCreator }).from(users).where(eq(users.id, userId)).limit(1);

  let count = 0;

  if (user?.isCreator) {
    // Creator: count doubts targeted at them that are open or ai_answered (need creator response)
    const [result] = await db.select({ count: sql<number>`count(*)::int` })
      .from(doubts)
      .where(and(
        eq(doubts.creatorId, userId),
        or(eq(doubts.status, "open"), eq(doubts.status, "ai_answered"))
      ));
    count = result?.count ?? 0;
  } else {
    // Student: count doubts they asked that have been answered but not closed
    const [result] = await db.select({ count: sql<number>`count(*)::int` })
      .from(doubts)
      .where(and(
        eq(doubts.studentId, userId),
        or(eq(doubts.status, "ai_answered"), eq(doubts.status, "creator_answered"))
      ));
    count = result?.count ?? 0;
  }

  return NextResponse.json({ success: true, data: { count } });
}
