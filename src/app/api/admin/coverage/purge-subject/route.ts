import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { and, eq, inArray, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { subjects, chapters, topics } from "@/db/schema/curriculum";
import { contentItems } from "@/db/schema/content";

/**
 * POST /api/admin/coverage/purge-subject
 * ----------------------------------------------------------------------------
 * Tear down a subject's ingested content so a fresh re-scrape (or re-fill)
 * starts from a clean slate. Needed after bug-fixes like the Sec/Sr_Sec
 * class-splitter rollout, where existing subject rows are known to be
 * contaminated with topics from the neighbouring class.
 *
 * Scopes (explicit opt-in, no "delete everything" default):
 *   • "content"  → delete only content_items for every topic in the subject.
 *                   Preserves curriculum tree (chapters / topics). Use when
 *                   you just want to re-run fill-gaps with a better prompt.
 *   • "chapters" → delete content_items + topics + chapters.
 *                   Preserves the subject row (and its standard/board FKs).
 *                   Use after the Sec-PDF class-split fix to let the CBSE
 *                   scraper re-parse chapters into the correct grade.
 *   • "subject"  → everything above PLUS the subject row itself.
 *                   Use only when the subject was wrongly created and
 *                   shouldn't exist at all.
 *
 * Cascade behaviour (from db/schema/curriculum.ts + content.ts):
 *   chapters.subject_id → subjects         ON DELETE CASCADE
 *   topics.chapter_id   → chapters         ON DELETE CASCADE
 *   content_items.topic_id → topics        ON DELETE CASCADE
 *   user_notes.topic_id → topics           ON DELETE SET NULL (intentional —
 *     student-authored notes survive a curriculum purge; the orphaned note
 *     just loses its topic link until the curriculum is re-ingested.)
 *
 * We could rely purely on cascades by issuing a single `DELETE FROM
 * subjects WHERE id = …`, but we issue the deletes explicitly so the
 * response can report accurate per-table counts to the admin UI.
 *
 * Safety:
 *   • Requires `confirm: true` in the body — no accidental nukes from curl.
 *   • Returns 409 when the subject still has queued/running scrape jobs
 *     tracking it (would race with the worker). Caller should cancel or
 *     wait for the job first.
 *
 * Not authoritative for production — this is an ops tool. Use with care.
 */

const purgeSchema = z.object({
  subjectId: z.number().int(),
  scope: z.enum(["content", "chapters", "subject"]),
  confirm: z.literal(true, {
    message: "confirm:true is required to run a destructive purge",
  }),
});

export async function POST(request: NextRequest) {
  const session = await auth();
  const isAdmin =
    session?.user?.role === "admin" || process.env.NODE_ENV === "development";
  if (!isAdmin) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "UNAUTHORIZED", message: "Admin access required" },
      },
      { status: 403 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "INVALID_JSON", message: "Invalid JSON" } },
      { status: 400 }
    );
  }

  const parsed = purgeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: parsed.error.issues[0].message,
        },
      },
      { status: 400 }
    );
  }

  const { subjectId, scope } = parsed.data;

  // Resolve subject so we can echo back context + reject unknown IDs before
  // doing any work.
  const [subject] = await db
    .select({
      id: subjects.id,
      name: subjects.name,
      code: subjects.code,
      standardId: subjects.standardId,
    })
    .from(subjects)
    .where(eq(subjects.id, subjectId))
    .limit(1);

  if (!subject) {
    return NextResponse.json(
      { success: false, error: { code: "NOT_FOUND", message: `Subject ${subjectId} not found` } },
      { status: 404 }
    );
  }

  // Guard against purging while a worker is actively writing to this subject.
  // We check scrape_jobs.metadata.subjectId (cbse_content_fill convention).
  // ncert_download jobs don't track subjectId that way — they have looser
  // scoping and are unlikely to collide in practice, so we only block on
  // the fill-gaps path.
  const activeJobs = await db.execute<{ id: number; status: string; job_type: string }>(sql`
    SELECT id, status, job_type FROM scrape_jobs
    WHERE job_type = 'cbse_content_fill'
      AND status IN ('queued', 'running')
      AND metadata->>'subjectId' = ${String(subjectId)}
    ORDER BY id DESC
    LIMIT 1
  `);
  const activeJob = activeJobs[0];
  if (activeJob) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "JOB_IN_FLIGHT",
          message: `Subject ${subjectId} has an active ${activeJob.job_type} job (#${activeJob.id}, ${activeJob.status}). Cancel or wait for it before purging.`,
        },
      },
      { status: 409 }
    );
  }

  // ---------------------------------------------------------------------------
  // Collect IDs so we can report accurate counts regardless of scope.
  // Done up-front (before any delete) so even the narrowest scope can tell
  // the admin what was reachable — useful when debugging "why did this
  // purge only delete 3 content_items?".
  // ---------------------------------------------------------------------------
  const chapterRows = await db
    .select({ id: chapters.id })
    .from(chapters)
    .where(eq(chapters.subjectId, subjectId));
  const chapterIds = chapterRows.map((r) => r.id);

  let topicIds: number[] = [];
  if (chapterIds.length > 0) {
    const topicRows = await db
      .select({ id: topics.id })
      .from(topics)
      .where(inArray(topics.chapterId, chapterIds));
    topicIds = topicRows.map((r) => r.id);
  }

  const counts = { contentItems: 0, topics: 0, chapters: 0, subjects: 0 };

  // ---------------------------------------------------------------------------
  // Deletes — issued in dependency order (leaves first) even though cascades
  // would handle it, because we want to .returning() counts at each level
  // and we don't want inconsistent row counts if a later step fails.
  // ---------------------------------------------------------------------------
  if (topicIds.length > 0) {
    const deletedContent = await db
      .delete(contentItems)
      .where(inArray(contentItems.topicId, topicIds))
      .returning({ id: contentItems.id });
    counts.contentItems = deletedContent.length;
  }

  if (scope === "chapters" || scope === "subject") {
    if (topicIds.length > 0) {
      const deletedTopics = await db
        .delete(topics)
        .where(inArray(topics.id, topicIds))
        .returning({ id: topics.id });
      counts.topics = deletedTopics.length;
    }
    if (chapterIds.length > 0) {
      const deletedChapters = await db
        .delete(chapters)
        .where(and(eq(chapters.subjectId, subjectId), inArray(chapters.id, chapterIds)))
        .returning({ id: chapters.id });
      counts.chapters = deletedChapters.length;
    }
  }

  if (scope === "subject") {
    const deletedSubjects = await db
      .delete(subjects)
      .where(eq(subjects.id, subjectId))
      .returning({ id: subjects.id });
    counts.subjects = deletedSubjects.length;
  }

  return NextResponse.json({
    success: true,
    data: {
      subject: {
        id: subject.id,
        name: subject.name,
        code: subject.code,
      },
      scope,
      deleted: counts,
      message: buildMessage(scope, counts, subject.name),
    },
  });
}

function buildMessage(
  scope: "content" | "chapters" | "subject",
  counts: { contentItems: number; topics: number; chapters: number; subjects: number },
  subjectName: string
): string {
  if (scope === "content") {
    return `Purged ${counts.contentItems} content_items row(s) for "${subjectName}". Chapters and topics preserved. Re-run fill-gaps to regenerate content.`;
  }
  if (scope === "chapters") {
    return `Purged ${counts.contentItems} content_items, ${counts.topics} topics, and ${counts.chapters} chapters for "${subjectName}". Subject row preserved. Re-run the syllabus scraper to repopulate.`;
  }
  return `Purged subject "${subjectName}" in full: ${counts.subjects} subject row, ${counts.chapters} chapters, ${counts.topics} topics, ${counts.contentItems} content_items.`;
}
