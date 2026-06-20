/**
 * POST /api/topics/[topicId]/request-content
 *
 * A student explicitly requests that Padvik create content for a topic.
 * Records a high-weight 'direct_request' demand signal (rate-limited to 5/day
 * per student to prevent spam).
 */
import { NextRequest, NextResponse } from "next/server";
import { and, eq, gte, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { topics } from "@/db/schema/curriculum";
import { contentDemandSignals } from "@/db/schema/auto-content";
import { trackDemandSignal } from "@/lib/auto-content";

const MAX_REQUESTS_PER_DAY = 5;

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ topicId: string }> }
) {
  const { topicId: topicIdParam } = await context.params;
  const topicId = Number(topicIdParam);
  if (!Number.isInteger(topicId) || topicId <= 0) {
    return NextResponse.json(
      { success: false, error: { code: "INVALID_TOPIC", message: "Bad topic id" } },
      { status: 400 }
    );
  }

  // Auth — student must be logged in
  const session = await auth();
  const rawId = session?.user?.id;
  const userId = rawId ? Number(rawId) : NaN;
  if (!rawId || Number.isNaN(userId)) {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Login required" } },
      { status: 401 }
    );
  }

  // Topic must exist
  const [topic] = await db
    .select({ id: topics.id })
    .from(topics)
    .where(eq(topics.id, topicId))
    .limit(1);
  if (!topic) {
    return NextResponse.json(
      { success: false, error: { code: "TOPIC_NOT_FOUND", message: "Topic not found" } },
      { status: 404 }
    );
  }

  // Rate limit — max 5 direct requests per student per day
  const [{ count } = { count: 0 }] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(contentDemandSignals)
    .where(
      and(
        eq(contentDemandSignals.studentId, userId),
        eq(contentDemandSignals.signalType, "direct_request"),
        gte(contentDemandSignals.createdAt, startOfToday())
      )
    );

  if (count >= MAX_REQUESTS_PER_DAY) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "RATE_LIMITED",
          message: `You can request up to ${MAX_REQUESTS_PER_DAY} topics per day. Please try again tomorrow.`,
        },
      },
      { status: 429 }
    );
  }

  await trackDemandSignal(topicId, "direct_request", userId, 5.0);

  return NextResponse.json({
    success: true,
    message:
      "Your request has been noted. Content will be created based on demand from students.",
  });
}
