/**
 * POST /api/admin/auto-content/generate
 *
 * Manually trigger auto-content generation for a specific topic + type.
 * Creates (or reuses) a high-priority auto_content_jobs row and enqueues the
 * process-auto-content BullMQ job immediately.
 */
import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { autoContentJobs } from "@/db/schema/auto-content";
import { topics, chapters, subjects, standards } from "@/db/schema/curriculum";
import { addProcessAutoContentJob } from "@/lib/auto-content/jobs";
import { reportError } from "@/lib/observability/sentry";

// Models an admin may pick. "default" = the configured rotation.
const ALLOWED_MODELS = [
  "default",
  "claude-opus-4-8",
  "claude-sonnet-4-6",
  "gemini-2.5-pro",
  "gpt-4o",
  "sonar",
  "mistral-large-latest",
] as const;

const BodySchema = z.object({
  topicId: z.coerce.number().int().positive(),
  contentType: z.enum(["text_note", "audio_explainer", "question_set", "video_lesson"]),
  model: z.enum(ALLOWED_MODELS).optional().default("default"),
});

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Admin access required" } },
      { status: 403 }
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
  const { topicId, contentType, model } = parsed.data;

  try {
    // 1. Topic must exist — resolve its board/standard/subject ids via the tree
    const [ctx] = await db
      .select({
        topicId: topics.id,
        subjectId: subjects.id,
        standardId: standards.id,
        boardId: standards.boardId,
      })
      .from(topics)
      .innerJoin(chapters, eq(chapters.id, topics.chapterId))
      .innerJoin(subjects, eq(subjects.id, chapters.subjectId))
      .innerJoin(standards, eq(standards.id, subjects.standardId))
      .where(eq(topics.id, topicId))
      .limit(1);

    if (!ctx) {
      return NextResponse.json(
        { success: false, error: { code: "TOPIC_NOT_FOUND", message: "Topic not found" } },
        { status: 404 }
      );
    }

    // 2. Existing job for this (topic, type, model)? — unique key guarantees ≤1.
    //    A different model is a separate job, so it produces a separate content
    //    item; the same model reuses (and replaces) the existing one.
    const [existing] = await db
      .select({ id: autoContentJobs.id, status: autoContentJobs.status })
      .from(autoContentJobs)
      .where(
        and(
          eq(autoContentJobs.topicId, topicId),
          eq(autoContentJobs.contentType, contentType),
          eq(autoContentJobs.requestedModel, model)
        )
      )
      .limit(1);

    let jobId: number;

    if (existing && existing.status === "generating") {
      // Genuinely in flight — don't double-queue
      return NextResponse.json({
        success: true,
        data: { jobId: existing.id, status: existing.status, note: "Already in progress" },
      });
    }

    if (existing) {
      // Reuse the row — reset to a fresh, top-priority queued job
      await db
        .update(autoContentJobs)
        .set({
          status: "queued",
          priority: 0,
          lastError: null,
          updatedAt: new Date(),
        })
        .where(eq(autoContentJobs.id, existing.id));
      jobId = existing.id;
    } else {
      // 3. New high-priority job (priority 0 = highest, manual trigger)
      const [created] = await db
        .insert(autoContentJobs)
        .values({
          topicId,
          boardId: ctx.boardId,
          standardId: ctx.standardId,
          subjectId: ctx.subjectId,
          contentType,
          requestedModel: model,
          priority: 0,
          status: "queued",
        })
        .returning({ id: autoContentJobs.id });
      jobId = created.id;
    }

    // 4. Queue the BullMQ processing job immediately
    await addProcessAutoContentJob(jobId);

    // 5. Respond
    return NextResponse.json({ success: true, data: { jobId, status: "queued" } });
  } catch (err) {
    reportError(err, { where: "api:auto-content:generate", topicId, contentType });
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: { code: "GENERATE_ERROR", message } },
      { status: 500 }
    );
  }
}
