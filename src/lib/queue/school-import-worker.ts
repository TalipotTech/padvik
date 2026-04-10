/**
 * BullMQ worker for school import jobs.
 */

import { Worker, type Job } from "bullmq";
import { createRedisConnection } from "../redis";
import type { SchoolImportJobData } from "./index";

let worker: Worker<SchoolImportJobData> | null = null;

export function startSchoolImportWorker() {
  if (worker) return;

  worker = new Worker<SchoolImportJobData>(
    "import-schools",
    async (job: Job<SchoolImportJobData>) => {
      const { source, stateFilter, csvPath } = job.data;
      console.log(`[school-import-worker] Running import: source=${source}, state=${stateFilter || "all"}`);

      const { importAllSchools } = await import("../schools/import-all");
      const results = await importAllSchools({
        sources: [source as "cbse_github" | "sametham" | "cbse_saras" | "icse_scrape" | "udise"],
        stateFilter,
        udiseCsvPath: csvPath,
      });

      return results;
    },
    {
      connection: createRedisConnection(),
      concurrency: 1,
    }
  );

  worker.on("completed", (job) => console.log(`[school-import-worker] Job ${job.id} completed`));
  worker.on("failed", (job, err) => console.error(`[school-import-worker] Job ${job?.id} failed:`, err.message));
  console.log("[school-import-worker] Started");
}

export async function stopSchoolImportWorker() {
  if (worker) { await worker.close(); worker = null; console.log("[school-import-worker] Stopped"); }
}
