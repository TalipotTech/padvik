/**
 * /api/admin/auto-content/[jobId]
 *
 * GET — full job details (job row + topic context + linked content).
 * PUT — approve or reject pending content.
 */
import { NextRequest, NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { autoContentJobs } from "@/db/schema/auto-content";
import { creatorContent, creatorProfiles } from "@/db/schema/creators";
import { topics, chapters, subjects, standards, boards } from "@/db/schema/curriculum";
import { reportError } from "@/lib/observability/sentry";

async function requireAdmin() {
  const session = await auth();
  if (!session || session.user.role !== "admin") return null;
  return session;
}

function unauthorized() {
  return NextResponse.json(
    { success: false, error: { code: "UNAUTHORIZED", message: "Admin access required" } },
    { status: 403 }
  );
}

function parseJobId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// ---------------------------------------------------------------------------
// GET — job details
// ---------------------------------------------------------------------------
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ jobId: string }> }
) {
  if (!(await requireAdmin())) return unauthorized();

  const { jobId: jobIdParam } = await context.params;
  const jobId = parseJobId(jobIdParam);
  if (jobId == null) {
    return NextResponse.json(
      { success: false, error: { code: "INVALID_JOB", message: "Bad job id" } },
      { status: 400 }
    );
  }

  const [job] = await db
    .select()
    .from(autoContentJobs)
    .where(eq(autoContentJobs.id, jobId))
    .limit(1);

  if (!job) {
    return NextResponse.json(
      { success: false, error: { code: "JOB_NOT_FOUND", message: "Job not found" } },
      { status: 404 }
    );
  }

  // Topic context
  const [topic] = await db
    .select({
      topicId: topics.id,
      topicName: topics.title,
      chapter: chapters.title,
      subject: subjects.name,
      board: boards.code,
      class: standards.grade,
    })
    .from(topics)
    .innerJoin(chapters, eq(chapters.id, topics.chapterId))
    .innerJoin(subjects, eq(subjects.id, chapters.subjectId))
    .innerJoin(standards, eq(standards.id, subjects.standardId))
    .innerJoin(boards, eq(boards.id, standards.boardId))
    .where(eq(topics.id, job.topicId))
    .limit(1);

  // Linked content (if any)
  let content = null;
  if (job.contentId != null) {
    const [row] = await db
      .select()
      .from(creatorContent)
      .where(eq(creatorContent.id, job.contentId))
      .limit(1);
    content = row ?? null;
  }

  return NextResponse.json({
    success: true,
    data: { job, topic: topic ?? null, content },
  });
}

// ---------------------------------------------------------------------------
// PUT — approve / reject
// ---------------------------------------------------------------------------
const BodySchema = z.object({
  action: z.enum(["approve", "reject"]),
  reviewNotes: z.string().max(2000).optional(),
});

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ jobId: string }> }
) {
  const session = await requireAdmin();
  if (!session) return unauthorized();
  // Demo/dev sessions use a non-numeric id (e.g. "demo-admin"); store null
  // rather than NaN, which the bigint reviewed_by column would reject.
  const adminIdNum = Number(session.user.id);
  const reviewerId = Number.isInteger(adminIdNum) && adminIdNum > 0 ? adminIdNum : null;

  const { jobId: jobIdParam } = await context.params;
  const jobId = parseJobId(jobIdParam);
  if (jobId == null) {
    return NextResponse.json(
      { success: false, error: { code: "INVALID_JOB", message: "Bad job id" } },
      { status: 400 }
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "BAD_BODY", message: parsed.error.issues[0]?.message ?? "invalid body" },
      },
      { status: 400 }
    );
  }
  const { action, reviewNotes } = parsed.data;

  const [job] = await db
    .select({ id: autoContentJobs.id, contentId: autoContentJobs.contentId })
    .from(autoContentJobs)
    .where(eq(autoContentJobs.id, jobId))
    .limit(1);

  if (!job) {
    return NextResponse.json(
      { success: false, error: { code: "JOB_NOT_FOUND", message: "Job not found" } },
      { status: 404 }
    );
  }

  const now = new Date();

  try {
    await db.transaction(async (tx) => {
      if (action === "approve") {
        await tx
          .update(autoContentJobs)
          .set({
            status: "published",
            reviewedBy: reviewerId,
            reviewNotes: reviewNotes ?? null,
            updatedAt: now,
          })
          .where(eq(autoContentJobs.id, jobId));

        if (job.contentId != null) {
          // Read prior publish state so the creator tally is incremented at
          // most once per content item (idempotent re-approval).
          const [prev] = await tx
            .select({
              creatorId: creatorContent.creatorId,
              isPublished: creatorContent.isPublished,
            })
            .from(creatorContent)
            .where(eq(creatorContent.id, job.contentId))
            .limit(1);

          await tx
            .update(creatorContent)
            .set({
              reviewStatus: "approved",
              isPublished: true,
              publishedAt: now,
              updatedAt: now,
            })
            .where(eq(creatorContent.id, job.contentId));

          if (prev && !prev.isPublished) {
            await tx
              .update(creatorProfiles)
              .set({
                contentCount: sql`${creatorProfiles.contentCount} + 1`,
                updatedAt: now,
              })
              .where(eq(creatorProfiles.userId, prev.creatorId));
          }
        }
      } else {
        // reject
        await tx
          .update(autoContentJobs)
          .set({
            status: "rejected",
            reviewedBy: reviewerId,
            reviewNotes: reviewNotes ?? null,
            updatedAt: now,
          })
          .where(eq(autoContentJobs.id, jobId));

        if (job.contentId != null) {
          await tx
            .update(creatorContent)
            .set({ reviewStatus: "rejected", isPublished: false, updatedAt: now })
            .where(eq(creatorContent.id, job.contentId));
        }
      }
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    reportError(err, { where: "api:auto-content:review", jobId, action });
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: { code: "REVIEW_ERROR", message } },
      { status: 500 }
    );
  }
}
