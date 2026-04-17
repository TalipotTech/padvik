/**
 * Pipeline stage: complete
 *
 * Finalization stage — runs after all other stages.
 * - Sets uploadStatus = "completed"
 * - Auto-moderation: flags low quality content
 * - Auto-publish: verified creators with high quality auto-approve
 */

import { db } from "@/db";
import { creatorContent, creatorProfiles } from "@/db/schema/creators";
import { eq } from "drizzle-orm";
import type { PipelineContext } from "../types";

export async function handleComplete(ctx: PipelineContext): Promise<void> {
  const updates: Record<string, unknown> = {
    uploadStatus: "completed",
    updatedAt: new Date(),
  };

  const score = ctx.result.aiQualityScore;

  // Auto-moderation: flag low quality content
  if (score !== undefined && score < 0.3) {
    updates.reviewStatus = "flagged";
  }

  // Auto-publish: high quality from verified creators
  if (score !== undefined && score >= 0.7) {
    try {
      const [profile] = await db
        .select({ verificationStatus: creatorProfiles.verificationStatus })
        .from(creatorProfiles)
        .where(eq(creatorProfiles.userId, ctx.content.creatorId))
        .limit(1);

      if (profile?.verificationStatus === "verified") {
        updates.isPublished = true;
        updates.publishedAt = new Date();
        updates.reviewStatus = "approved";
      }
    } catch {
      // DB lookup failed — skip auto-publish, stay pending
    }
  }

  await db
    .update(creatorContent)
    .set(updates)
    .where(eq(creatorContent.id, ctx.contentId));
}
