/**
 * BullMQ worker for processing scrape jobs.
 * Resolves the correct scraper by board code and runs the scrape pipeline.
 * Calls job.updateProgress() so the frontend can poll real-time status.
 */
import { Worker, Job } from "bullmq";
import { eq } from "drizzle-orm";
import { createRedisConnection } from "../redis";
import { db } from "@/db";
import { scrapeJobs } from "@/db/schema/system";
import { contentPipelineLogs } from "@/db/schema/system";
import type { ScrapeJobData } from "./index";
import type { BaseScraper } from "../scraper/base-scraper";
import { CbseScraper } from "../scraper/cbse-scraper";
import { IcseScraper } from "../scraper/icse-scraper";
import { KeralaScraper } from "../scraper/kerala-scraper";
import { CbseQuestionScraper } from "../scraper/cbse-question-scraper";

/** Progress object stored on the BullMQ job, polled by frontend */
export interface ScrapeProgress {
  status: "queued" | "fetching_index" | "downloading_pdfs" | "parsing" | "completed" | "failed";
  boardCode: string;
  pagesVisited: number;
  pagesTotal: number;
  pdfsProcessed: number;
  pdfsTotal: number;
  chaptersFound: number;
  topicsFound: number;
  currentPdf?: string;
  errorsCount: number;
  startedAt: string;
  aiModel?: string;
  tokensSoFar: number;
  costSoFar: number;
  aiProvider: string;
}

const SCRAPER_CONFIG = { rateLimitMs: 3000 };

/**
 * For "textbook" job type on CBSE, we route to the NCERT downloader
 * instead of the syllabus scraper, since CBSE textbooks ARE NCERT books.
 * Returns null if the job should be handled by a specialized pipeline.
 */
function getScraperForJob(boardCode: string, jobType: string): BaseScraper | null {
  if (jobType === "question_paper") {
    switch (boardCode.toUpperCase()) {
      case "CBSE":
        return new CbseQuestionScraper(SCRAPER_CONFIG);
      default:
        throw new Error(`No question paper scraper for board: ${boardCode}`);
    }
  }

  // "textbook" for CBSE should use NCERT downloader — handled via ncert-download queue
  if (jobType === "textbook" && boardCode.toUpperCase() === "CBSE") {
    return null; // Signal to use NCERT pipeline instead
  }

  switch (boardCode.toUpperCase()) {
    case "CBSE":
      return new CbseScraper(SCRAPER_CONFIG);
    case "ICSE":
      return new IcseScraper(SCRAPER_CONFIG);
    case "KL_SCERT":
      return new KeralaScraper(SCRAPER_CONFIG);
    default:
      throw new Error(`No scraper implementation for board: ${boardCode}. Use the specific pipeline job type (ncert_download, diksha_ingest, kerala_scrape, state_board_scrape) instead.`);
  }
}

let worker: Worker<ScrapeJobData> | null = null;

export function startScrapeWorker(): Worker<ScrapeJobData> {
  if (worker) return worker;

  worker = new Worker<ScrapeJobData>(
    "scrape",
    async (job: Job<ScrapeJobData>) => {
      const { jobId, boardCode, jobType, grades, maxPdfs, aiProvider, retrySkipped } = job.data;
      const startTime = Date.now();

      console.log(
        `[ScrapeWorker] Processing job ${jobId} for board ${boardCode} type ${jobType} (AI: ${aiProvider ?? "auto"})`
      );

      // Initialize progress on the BullMQ job
      const progress: ScrapeProgress = {
        status: "fetching_index",
        boardCode,
        pagesVisited: 0,
        pagesTotal: 0,
        pdfsProcessed: 0,
        pdfsTotal: 0,
        chaptersFound: 0,
        topicsFound: 0,
        errorsCount: 0,
        startedAt: new Date().toISOString(),
        aiProvider: aiProvider ?? "auto",
        tokensSoFar: 0,
        costSoFar: 0,
      };
      await job.updateProgress(progress);

      try {
        // Update DB status to running
        await db
          .update(scrapeJobs)
          .set({ status: "running", startedAt: new Date() })
          .where(eq(scrapeJobs.id, jobId));

        // Resolve and run the scraper
        // On retry, check if previous attempt saved processedUrls to resume from
        let processedUrls: string[] | undefined;
        try {
          const [existingJob] = await db
            .select({ metadata: scrapeJobs.metadata })
            .from(scrapeJobs)
            .where(eq(scrapeJobs.id, jobId))
            .limit(1);
          const meta = (existingJob?.metadata as Record<string, unknown>) ?? {};
          const prevResult = meta.scrapeResult as { processedUrls?: string[] } | undefined;
          if (prevResult?.processedUrls && prevResult.processedUrls.length > 0) {
            processedUrls = prevResult.processedUrls;
            console.log(`[ScrapeWorker] Resuming: ${processedUrls.length} PDFs already done`);
          }
        } catch {
          // Ignore — fresh start
        }

        const scraper = getScraperForJob(boardCode, jobType);

        // If null, this is a CBSE textbook job — route to NCERT downloader directly
        if (scraper === null) {
          console.log(`[ScrapeWorker] Routing CBSE textbook job to NCERT downloader`);
          const { runNcertDownload } = await import("../scraper/ncert-downloader");
          const ncertResult = await runNcertDownload({
            jobId,
            grades,
            maxChapters: maxPdfs ?? 50,
            aiProvider: aiProvider ?? "auto",
            resume: true,
          });

          progress.status = "completed";
          progress.pdfsProcessed = ncertResult.chaptersDownloaded;
          await job.updateProgress(progress);

          await db.update(scrapeJobs).set({
            status: "completed",
            completedAt: new Date(),
            itemsProcessed: ncertResult.chaptersDownloaded,
          }).where(eq(scrapeJobs.id, jobId));

          return { processed: ncertResult.chaptersDownloaded };
        }

        const processed = await scraper.scrape({
          jobId,
          grades,
          maxPdfs,
          aiProvider: aiProvider ?? "auto",
          processedUrls,
          retrySkipped,
        });

        // Final progress update
        progress.status = "completed";
        progress.pdfsProcessed = processed;
        await job.updateProgress(progress);

        // Mark completed in DB
        await db
          .update(scrapeJobs)
          .set({
            status: "completed",
            completedAt: new Date(),
            itemsProcessed: processed,
          })
          .where(eq(scrapeJobs.id, jobId));

        // Log to pipeline
        await db.insert(contentPipelineLogs).values({
          pipelineStage: "scrape",
          entityType: "scrape_job",
          entityId: jobId,
          status: "completed",
          outputData: {
            itemsProcessed: processed,
            boardCode,
            aiProvider: aiProvider ?? "auto",
          },
          processingTimeMs: Date.now() - startTime,
        });

        console.log(
          `[ScrapeWorker] Job ${jobId} completed. Processed ${processed} items in ${Math.round((Date.now() - startTime) / 1000)}s`
        );

        return { processed };
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);

        progress.status = "failed";
        progress.errorsCount++;
        await job.updateProgress(progress);

        await db
          .update(scrapeJobs)
          .set({
            status: "failed",
            completedAt: new Date(),
            errorLog: errorMessage,
          })
          .where(eq(scrapeJobs.id, jobId));

        await db.insert(contentPipelineLogs).values({
          pipelineStage: "scrape",
          entityType: "scrape_job",
          entityId: jobId,
          status: "failed",
          errorMessage,
          processingTimeMs: Date.now() - startTime,
        });

        console.error(`[ScrapeWorker] Job ${jobId} failed:`, errorMessage);
        throw err;
      }
    },
    {
      connection: createRedisConnection(),
      concurrency: 2,
    }
  );

  worker.on("error", (err) => {
    console.error("[ScrapeWorker] Worker error:", err.message);
  });

  console.log("[ScrapeWorker] Started and waiting for jobs...");
  return worker;
}

export async function stopScrapeWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
    console.log("[ScrapeWorker] Stopped.");
  }
}
