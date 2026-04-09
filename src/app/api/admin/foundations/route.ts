import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { z } from "zod/v4";
import { db } from "@/db";
import { contentItems } from "@/db/schema/content";
import { topics } from "@/db/schema/curriculum";
import { boards, standards, subjects, chapters } from "@/db/schema/curriculum";
import { eq, sql, desc } from "drizzle-orm";
import { addFoundationJob } from "@/lib/queue";

/** GET — foundation content stats */
export async function GET() {
  const session = await auth();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Admin access required" } },
      { status: 403 }
    );
  }

  try {
    // Count total topics vs topics with foundation content
    const [topicCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(topics);

    const [foundationCount] = await db
      .select({ count: sql<number>`count(DISTINCT topic_id)::int` })
      .from(contentItems)
      .where(eq(contentItems.contentType, "foundation"));

    // Per-board breakdown
    const boardStats = await db
      .select({
        boardCode: boards.code,
        boardName: boards.name,
        totalTopics: sql<number>`count(DISTINCT ${topics.id})::int`,
        withFoundation: sql<number>`count(DISTINCT CASE WHEN ci.id IS NOT NULL THEN ${topics.id} END)::int`,
      })
      .from(topics)
      .innerJoin(chapters, eq(chapters.id, topics.chapterId))
      .innerJoin(subjects, eq(subjects.id, chapters.subjectId))
      .innerJoin(standards, eq(standards.id, subjects.standardId))
      .innerJoin(boards, eq(boards.id, standards.boardId))
      .leftJoin(
        sql`content_items ci`,
        sql`ci.topic_id = ${topics.id} AND ci.content_type = 'foundation' AND ci.is_published = true`
      )
      .groupBy(boards.code, boards.name)
      .orderBy(desc(sql`count(DISTINCT ${topics.id})`));

    // Recent 5 foundations
    const recent = await db
      .select({
        id: contentItems.id,
        title: contentItems.title,
        topicId: contentItems.topicId,
        metadata: contentItems.metadata,
        createdAt: contentItems.createdAt,
      })
      .from(contentItems)
      .where(eq(contentItems.contentType, "foundation"))
      .orderBy(desc(contentItems.createdAt))
      .limit(5);

    return NextResponse.json({
      success: true,
      data: {
        totalTopics: topicCount?.count ?? 0,
        withFoundation: foundationCount?.count ?? 0,
        coverage: topicCount?.count
          ? Math.round(((foundationCount?.count ?? 0) / topicCount.count) * 100)
          : 0,
        boards: boardStats,
        recent,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: { code: "QUERY_ERROR", message } },
      { status: 500 }
    );
  }
}

const bulkSchema = z.object({
  boardCodes: z.array(z.string()).optional(),
  grades: z.array(z.number().int()).optional(),
  batchSize: z.number().int().min(1).max(100).optional(),
  dryRun: z.boolean().optional(),
});

/** POST — trigger bulk foundation generation */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Admin access required" } },
      { status: 403 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const parsed = bulkSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } },
      { status: 400 }
    );
  }

  try {
    const jobId = await addFoundationJob({
      boardCodes: parsed.data.boardCodes,
      grades: parsed.data.grades,
      batchSize: parsed.data.batchSize ?? 20,
      dryRun: parsed.data.dryRun,
    });

    return NextResponse.json({
      success: true,
      data: { jobId, status: "queued" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: { code: "QUEUE_ERROR", message } },
      { status: 500 }
    );
  }
}
