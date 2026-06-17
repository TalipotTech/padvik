import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { and, eq, inArray } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { chapters, topics, subjects, standards } from "@/db/schema/curriculum";
import { contentItems } from "@/db/schema/content";

// ---------------------------------------------------------------------------
// POST /api/admin/coverage/purge-stale
//
// Narrow-scope cleanup for orphan content rows — e.g. the Fill Gaps AI
// content that's superseded once NCERT Bootstrap lands real textbook content
// on the same topics. The caller MUST supply `subjectId`, so the blast
// radius is never wider than one subject's topic tree.
//
// Body:
//   {
//     subjectId: number,              // required — only rows under this
//                                     // subject's topics can be deleted.
//     sourceType?: string,            // defaults to "ai_generated". Accepts
//                                     // any content_items.source_type value.
//     dryRun?: boolean,               // defaults to TRUE. Must explicitly
//                                     // send false to actually delete.
//     onlyUnpublished?: boolean,      // defaults to TRUE. Protects any row
//                                     // that was flipped to published
//                                     // (students may already be reading it).
//   }
//
// Response (dry run):
//   { success, data: { dryRun: true, candidateCount, topicsAffected,
//                      sample: [first 10 candidate rows] } }
// Response (real):
//   { success, data: { dryRun: false, deletedCount, topicsAffected } }
//
// Same dev-bypass pattern as the other admin content-ops endpoints.
// ---------------------------------------------------------------------------

const purgeSchema = z.object({
  subjectId: z.number().int().positive(),
  sourceType: z.string().min(1).default("ai_generated"),
  dryRun: z.boolean().default(true),
  onlyUnpublished: z.boolean().default(true),
});

export async function POST(request: NextRequest) {
  const session = await auth();
  const isAdmin =
    session?.user?.role === "admin" ||
    (!session && process.env.NODE_ENV === "development");
  if (!isAdmin) {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Admin access required" } },
      { status: 403 },
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "INVALID_JSON", message: "Invalid JSON body" } },
      { status: 400 },
    );
  }
  const parsed = purgeSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message },
      },
      { status: 400 },
    );
  }
  const { subjectId, sourceType, dryRun, onlyUnpublished } = parsed.data;

  // Resolve the subject's scope — we want both a human-readable confirmation
  // (board + grade + academicYear) so the admin can sanity-check the label
  // before pulling the trigger, AND the full topic_id list so the DELETE can
  // be strictly confined to this subject.
  const [scope] = await db
    .select({
      subjectId: subjects.id,
      subjectName: subjects.name,
      subjectCode: subjects.code,
      standardId: standards.id,
      grade: standards.grade,
      academicYear: standards.academicYear,
      boardId: standards.boardId,
    })
    .from(subjects)
    .innerJoin(standards, eq(subjects.standardId, standards.id))
    .where(eq(subjects.id, subjectId))
    .limit(1);

  if (!scope) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "SUBJECT_NOT_FOUND", message: `No subject with id ${subjectId}` },
      },
      { status: 404 },
    );
  }

  const chapterRows = await db
    .select({ id: chapters.id })
    .from(chapters)
    .where(eq(chapters.subjectId, subjectId));
  const chapterIds = chapterRows.map((c) => c.id);

  if (chapterIds.length === 0) {
    return NextResponse.json({
      success: true,
      data: {
        dryRun,
        scope,
        candidateCount: 0,
        topicsAffected: 0,
        message: "Subject has no chapters — nothing to purge.",
      },
    });
  }

  const topicRows = await db
    .select({ id: topics.id })
    .from(topics)
    .where(inArray(topics.chapterId, chapterIds));
  const topicIds = topicRows.map((t) => t.id);

  if (topicIds.length === 0) {
    return NextResponse.json({
      success: true,
      data: {
        dryRun,
        scope,
        candidateCount: 0,
        topicsAffected: 0,
        message: "Subject has no topics — nothing to purge.",
      },
    });
  }

  // Build the predicate. `onlyUnpublished` is the safety net: a stale AI row
  // that somehow got auto-approved into the published flow shouldn't be
  // silently yanked out from under students — require an explicit override.
  const predicates = [
    inArray(contentItems.topicId, topicIds),
    eq(contentItems.sourceType, sourceType),
  ];
  if (onlyUnpublished) {
    predicates.push(eq(contentItems.isPublished, false));
  }
  const whereClause = and(...predicates);

  // Count + sample candidates (dry run) — or delete (real).
  if (dryRun) {
    const candidates = await db
      .select({
        id: contentItems.id,
        topicId: contentItems.topicId,
        sourceType: contentItems.sourceType,
        isPublished: contentItems.isPublished,
        qualityScore: contentItems.qualityScore,
        title: contentItems.title,
        createdAt: contentItems.createdAt,
      })
      .from(contentItems)
      .where(whereClause);

    const topicsAffected = new Set(candidates.map((c) => c.topicId)).size;

    return NextResponse.json({
      success: true,
      data: {
        dryRun: true,
        scope,
        sourceType,
        onlyUnpublished,
        candidateCount: candidates.length,
        topicsAffected,
        sample: candidates.slice(0, 10),
        note:
          candidates.length === 0
            ? "No rows matched the predicate. Nothing to delete."
            : "Re-send with { dryRun: false } to actually delete these rows.",
      },
    });
  }

  // Real delete. Drizzle returns the affected row ids when we pass
  // `.returning({ id })`, which also gives us the deletedCount without a
  // separate COUNT query.
  const deleted = await db
    .delete(contentItems)
    .where(whereClause)
    .returning({ id: contentItems.id, topicId: contentItems.topicId });

  const topicsAffected = new Set(deleted.map((d) => d.topicId)).size;

  return NextResponse.json({
    success: true,
    data: {
      dryRun: false,
      scope,
      sourceType,
      onlyUnpublished,
      deletedCount: deleted.length,
      topicsAffected,
      message: `Deleted ${deleted.length} row(s) across ${topicsAffected} topic(s).`,
    },
  });
}
