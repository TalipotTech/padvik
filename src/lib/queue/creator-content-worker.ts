/**
 * BullMQ worker for processing creator content through the AI pipeline.
 * Handles: summarize, tag, quality check, language detection.
 */

import { Worker, type Job } from "bullmq";
import { createRedisConnection } from "../redis";
import type { CreatorContentJobData } from "./index";
import { processCreatorContent } from "../content-pipeline/processor";

let worker: Worker<CreatorContentJobData> | null = null;

export function startCreatorContentWorker() {
  if (worker) return;

  worker = new Worker<CreatorContentJobData>(
    "creator-content-process",
    async (job: Job<CreatorContentJobData>) => {
      const { contentId, action } = job.data;
      console.log(`[creator-content-worker] Processing content ${contentId}, action: ${action}`);

      const result = await processCreatorContent(contentId);

      console.log(
        `[creator-content-worker] Content ${contentId} processed:`,
        `summary=${result.aiSummary ? "yes" : "no"}`,
        `tags=${result.aiTags?.length ?? 0}`,
        `quality=${result.aiQualityScore ?? "n/a"}`,
        `lang=${result.aiLanguage ?? "n/a"}`
      );

      return result;
    },
    {
      connection: createRedisConnection(),
      concurrency: 2, // Process 2 content items in parallel
      limiter: {
        max: 10,
        duration: 60_000, // Max 10 jobs per minute (to stay within AI rate limits)
      },
    }
  );

  worker.on("completed", (job) => {
    console.log(`[creator-content-worker] Job ${job.id} completed for content ${job.data.contentId}`);
  });

  worker.on("failed", (job, err) => {
    console.error(`[creator-content-worker] Job ${job?.id} failed:`, err.message);
  });

  console.log("[creator-content-worker] Started");
}

export async function stopCreatorContentWorker() {
  if (worker) {
    await worker.close();
    worker = null;
    console.log("[creator-content-worker] Stopped");
  }
}
