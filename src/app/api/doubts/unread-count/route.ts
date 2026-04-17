import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { doubts } from "@/db/schema/doubts";
import { users } from "@/db/schema/auth";
import { eq, and, or, sql, ne } from "drizzle-orm";

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

  const userId = Number(session.user.id);

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
