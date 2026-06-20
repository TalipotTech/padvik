/**
 * Worker process entry point.
 * Starts all BullMQ workers and handles graceful shutdown.
 *
 * Usage: pnpm workers (or: tsx src/lib/queue/start-workers.ts)
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config(); // Also try .env as fallback
import { startScrapeWorker, stopScrapeWorker } from "./scrape-worker";
import { startContentWorker, stopContentWorker } from "./content-worker";
import { startFileWorker, stopFileWorker } from "./file-worker";
import { startAllPipelineWorkers, stopAllPipelineWorkers } from "./pipeline-worker";
import { startCreatorContentWorker, stopCreatorContentWorker } from "./creator-content-worker";
import { startSchoolImportWorker, stopSchoolImportWorker } from "./school-import-worker";
import { startAutoContentWorkers, stopAutoContentWorkers } from "../auto-content/jobs";
import { closeRedis } from "../redis";

async function main() {
  console.log("[Workers] Starting all workers...");

  startScrapeWorker();
  startContentWorker();
  startFileWorker();
  startAllPipelineWorkers();
  startCreatorContentWorker();
  startSchoolImportWorker();
  await startAutoContentWorkers();

  console.log("[Workers] All workers started. Press Ctrl+C to stop.");

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n[Workers] Received ${signal}. Shutting down gracefully...`);

    await Promise.all([
      stopScrapeWorker(),
      stopContentWorker(),
      stopFileWorker(),
      stopAllPipelineWorkers(),
      stopCreatorContentWorker(),
      stopSchoolImportWorker(),
      stopAutoContentWorkers(),
    ]);

    await closeRedis();
    console.log("[Workers] All workers stopped. Goodbye.");
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("[Workers] Fatal error:", err);
  process.exit(1);
});
