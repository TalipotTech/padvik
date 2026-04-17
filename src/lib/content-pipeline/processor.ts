/**
 * Content processing pipeline — stage-based runner.
 *
 * Each content type has its own ordered list of stages (defined in pipelines.ts).
 * The runner dispatches stages sequentially, tracks progress in metadata,
 * and supports resuming from a failed stage on retry.
 *
 * Called asynchronously via BullMQ after content upload.
 * Worker interface is unchanged: processCreatorContent(contentId).
 */

import { db } from "@/db";
import { creatorContent } from "@/db/schema/creators";
import { contentPipelineLogs } from "@/db/schema/system";
import { eq } from "drizzle-orm";
import type { ContentType, PipelineContext, ProcessingResult } from "./types";
import { getPipelineForContentType } from "./pipelines";
import { getStageHandler } from "./stages";
import { AI_MODELS } from "@/lib/ai/provider";

// ---------------------------------------------------------------------------
// Main entry point (public API — unchanged for worker compatibility)
// ---------------------------------------------------------------------------

/**
 * Process a creator content item through the type-specific pipeline.
 * Supports resuming from the last failed stage on retry.
 */
export async function processCreatorContent(contentId: number): Promise<ProcessingResult> {
  // 1. Load content from DB
  const [content] = await db
    .select()
    .from(creatorContent)
    .where(eq(creatorContent.id, contentId))
    .limit(1);

  if (!content) {
    throw new Error(`Content ${contentId} not found`);
  }

  // 2. Determine content type and get pipeline stages
  const contentType = content.contentType as ContentType;
  const stages = getPipelineForContentType(contentType);
  const metadata = (content.metadata as Record<string, unknown>) ?? {};

  // 3. Determine resume point from completed stages
  const completedStages = new Set(
    (metadata.pipelineCompletedStages as string[]) ?? []
  );
  let startIndex = 0;
  for (let i = 0; i < stages.length; i++) {
    if (completedStages.has(stages[i])) {
      startIndex = i + 1;
    } else {
      break;
    }
  }

  // 4. Build pipeline context
  const ctx: PipelineContext = {
    contentId,
    content: content as PipelineContext["content"],
    result: {},
    metadata: { ...metadata },
    startTime: Date.now(),
  };

  // 5. Short-circuit: all stages already completed
  if (startIndex >= stages.length) {
    return ctx.result;
  }

  // 6. Mark pipeline as processing
  ctx.metadata.pipelineStartedAt =
    ctx.metadata.pipelineStartedAt ?? new Date().toISOString();
  delete ctx.metadata.pipelineError;

  await db
    .update(creatorContent)
    .set({
      uploadStatus: "processing",
      metadata: ctx.metadata,
      updatedAt: new Date(),
    })
    .where(eq(creatorContent.id, contentId));

  // 7. Run stages sequentially
  for (let i = startIndex; i < stages.length; i++) {
    const stageName = stages[i];
    const handler = getStageHandler(stageName);
    const stageStart = Date.now();

    try {
      await handler(ctx);

      // Record successful completion
      const completed =
        (ctx.metadata.pipelineCompletedStages as string[]) ?? [];
      completed.push(stageName);
      ctx.metadata.pipelineCompletedStages = completed;
      ctx.metadata.pipelineStage = stageName;
      delete ctx.metadata.pipelineError;

      // Build DB column updates from accumulated result
      const updates: Record<string, unknown> = {
        metadata: ctx.metadata,
        updatedAt: new Date(),
      };

      if (ctx.result.aiSummary) updates.aiSummary = ctx.result.aiSummary;
      if (ctx.result.aiTags && ctx.result.aiTags.length > 0)
        updates.aiTags = ctx.result.aiTags;
      if (ctx.result.aiQualityScore !== undefined)
        updates.aiQualityScore = String(ctx.result.aiQualityScore);
      if (ctx.result.aiLanguage) updates.aiLanguage = ctx.result.aiLanguage;
      if (ctx.result.thumbnailUrl)
        updates.thumbnailUrl = ctx.result.thumbnailUrl;
      if (ctx.result.processedUrl)
        updates.processedUrl = ctx.result.processedUrl;

      // Don't overwrite uploadStatus here — the complete stage handles that
      if (stageName !== "complete") {
        await db
          .update(creatorContent)
          .set(updates)
          .where(eq(creatorContent.id, contentId));
      }

      await logStage(contentId, stageName, "done", Date.now() - stageStart);
    } catch (err) {
      // Stage failed — record error and stop pipeline
      ctx.metadata.pipelineStage = stageName;
      ctx.metadata.pipelineError =
        err instanceof Error ? err.message : String(err);

      await db
        .update(creatorContent)
        .set({
          uploadStatus: "failed",
          metadata: ctx.metadata,
          updatedAt: new Date(),
        })
        .where(eq(creatorContent.id, contentId));

      await logStage(
        contentId,
        stageName,
        "failed",
        Date.now() - stageStart,
        err
      );
      throw err;
    }
  }

  return ctx.result;
}

// ---------------------------------------------------------------------------
// Pipeline logging
// ---------------------------------------------------------------------------

async function logStage(
  contentId: number,
  stage: string,
  status: string,
  durationMs: number,
  error?: unknown
) {
  try {
    await db.insert(contentPipelineLogs).values({
      pipelineStage: `creator_${stage}`,
      entityType: "creator_content",
      entityId: contentId,
      status,
      processingTimeMs: durationMs,
      aiModelUsed: AI_MODELS.BULK,
      aiProvider: "anthropic",
      errorMessage: error instanceof Error ? error.message : undefined,
    });
  } catch {
    // Don't fail the pipeline because of a logging error
    console.error(
      `[pipeline] Failed to log stage ${stage} for content ${contentId}`
    );
  }
}
