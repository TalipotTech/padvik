/**
 * Stale processing checker — marks content stuck in "processing" as failed.
 * Content should never stay in "processing" for more than 30 minutes.
 */

import { db } from "@/db";
import { creatorContent } from "@/db/schema/creators";
import { eq, and, lt } from "drizzle-orm";

const STALE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Find all content items stuck in "processing" for more than 30 minutes
 * and mark them as "failed" with a timeout error.
 *
 * @returns Number of items marked as failed
 */
export async function markStaleProcessingAsFailed(): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS);

  const staleItems = await db
    .select({ id: creatorContent.id, metadata: creatorContent.metadata })
    .from(creatorContent)
    .where(
      and(
        eq(creatorContent.uploadStatus, "processing"),
        lt(creatorContent.updatedAt, cutoff)
      )
    );

  if (staleItems.length === 0) return 0;

  let count = 0;
  for (const item of staleItems) {
    const metadata = (item.metadata as Record<string, unknown>) ?? {};
    metadata.pipelineError = "Processing timed out after 30 minutes";

    await db
      .update(creatorContent)
      .set({
        uploadStatus: "failed",
        metadata,
        updatedAt: new Date(),
      })
      .where(eq(creatorContent.id, item.id));

    count++;
  }

  if (count > 0) {
    console.log(`[stale-checker] Marked ${count} stale processing items as failed`);
  }

  return count;
}
