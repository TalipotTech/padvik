/**
 * BullMQ worker for bulk foundation content generation.
 */
import { Worker, type Job } from "bullmq";
import { createRedisConnection } from "../redis";
import type { FoundationGenerateJobData } from "./index";

export function startFoundationWorker(): Worker<FoundationGenerateJobData> {
  const worker = new Worker<FoundationGenerateJobData>(
    "foundation-generate",
    async (job: Job<FoundationGenerateJobData>) => {
      const { bulkGenerateFoundations } = await import(
        "../ai/foundation-builder"
      );

      console.log(
        `[FoundationWorker] Starting bulk generation (batch: ${job.data.batchSize ?? 20})`
      );

      const result = await bulkGenerateFoundations({
        topicIds: job.data.topicIds,
        boardCodes: job.data.boardCodes,
        grades: job.data.grades,
        batchSize: job.data.batchSize,
        dryRun: job.data.dryRun,
      });

      console.log(
        `[FoundationWorker] Done: ${result.processed} processed, ${result.skipped} skipped, $${result.totalCostUsd.toFixed(4)}`
      );

      return result;
    },
    {
      connection: createRedisConnection(),
      concurrency: 1,
    }
  );

  worker.on("failed", (job, err) => {
    console.error(
      `[FoundationWorker] Job ${job?.id} failed:`,
      err.message
    );
  });

  return worker;
}
