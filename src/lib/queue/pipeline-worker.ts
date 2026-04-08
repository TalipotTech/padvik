/**
 * BullMQ workers for all content acquisition pipeline queues:
 * - ncert-download: Downloads NCERT textbook chapter PDFs + AI parse
 * - diksha-ingest: Ingests content from DIKSHA/Sunbird API
 * - kerala-scrape: Downloads Kerala SCERT textbooks
 * - state-board-scrape: Karnataka, TN, MH, AP/TS scrapers + NCERT mappings
 * - content-generate: AI content gap filler (notes, flashcards, MCQs)
 */
import { Worker, type Job } from "bullmq";
import { createRedisConnection } from "../redis";
import type {
  NcertDownloadJobData,
  DikshaIngestJobData,
  KeralaScrapeJobData,
  StateBoardScrapeJobData,
  ContentGenerateJobData,
} from "./index";

// ---------------------------------------------------------------------------
// Worker instances
// ---------------------------------------------------------------------------

let ncertWorker: Worker | null = null;
let dikshaWorker: Worker | null = null;
let keralaWorker: Worker | null = null;
let stateBoardWorker: Worker | null = null;
let contentGenWorker: Worker | null = null;

// ---------------------------------------------------------------------------
// NCERT Download Worker
// ---------------------------------------------------------------------------

export function startNcertWorker(): Worker<NcertDownloadJobData> {
  if (ncertWorker) return ncertWorker as Worker<NcertDownloadJobData>;

  ncertWorker = new Worker<NcertDownloadJobData>(
    "ncert-download",
    async (job: Job<NcertDownloadJobData>) => {
      console.log(`[NcertWorker] Processing job ${job.data.jobId}`);
      const { runNcertDownload } = await import("../scraper/ncert-downloader");
      const result = await runNcertDownload({
        jobId: job.data.jobId,
        grades: job.data.grades,
        subjects: job.data.subjects,
        languages: job.data.languages,
        aiProvider: job.data.aiProvider,
        maxChapters: job.data.maxChapters,
        downloadOnly: job.data.downloadOnly,
        resume: true,
      });
      console.log(`[NcertWorker] Job ${job.data.jobId} done: ${result.chaptersDownloaded} chapters`);
      return result;
    },
    { connection: createRedisConnection(), concurrency: 1 }
  );

  ncertWorker.on("error", (err) => console.error("[NcertWorker] Error:", err.message));
  console.log("[NcertWorker] Started");
  return ncertWorker as Worker<NcertDownloadJobData>;
}

// ---------------------------------------------------------------------------
// DIKSHA Ingest Worker
// ---------------------------------------------------------------------------

export function startDikshaWorker(): Worker<DikshaIngestJobData> {
  if (dikshaWorker) return dikshaWorker as Worker<DikshaIngestJobData>;

  dikshaWorker = new Worker<DikshaIngestJobData>(
    "diksha-ingest",
    async (job: Job<DikshaIngestJobData>) => {
      console.log(`[DikshaWorker] Processing job ${job.data.jobId}`);
      const { runDikshaIngestion } = await import("../scraper/diksha-ingestion");
      const result = await runDikshaIngestion({
        boardCode: job.data.boardCode,
        gradeStart: job.data.gradeStart,
        gradeEnd: job.data.gradeEnd,
        subjectFilter: job.data.subjectFilter,
        medium: job.data.medium,
        jobId: job.data.jobId,
      });
      console.log(`[DikshaWorker] Job ${job.data.jobId} done: ${result.textbooksFound} textbooks found`);
      return result;
    },
    { connection: createRedisConnection(), concurrency: 1 }
  );

  dikshaWorker.on("error", (err) => console.error("[DikshaWorker] Error:", err.message));
  console.log("[DikshaWorker] Started");
  return dikshaWorker as Worker<DikshaIngestJobData>;
}

// ---------------------------------------------------------------------------
// Kerala Scrape Worker
// ---------------------------------------------------------------------------

export function startKeralaWorker(): Worker<KeralaScrapeJobData> {
  if (keralaWorker) return keralaWorker as Worker<KeralaScrapeJobData>;

  keralaWorker = new Worker<KeralaScrapeJobData>(
    "kerala-scrape",
    async (job: Job<KeralaScrapeJobData>) => {
      console.log(`[KeralaWorker] Processing job ${job.data.jobId}`);
      const { runKeralaScrape } = await import("../scraper/kerala-textbook-scraper");
      const result = await runKeralaScrape({
        classStart: job.data.classStart,
        classEnd: job.data.classEnd,
        medium: job.data.medium,
        subjectFilter: job.data.subjectFilter,
        aiProvider: job.data.aiProvider,
        maxBooks: job.data.maxBooks,
        downloadOnly: job.data.downloadOnly,
        useDikshaDiscovery: job.data.useDikshaDiscovery,
        jobId: job.data.jobId,
      });
      console.log(`[KeralaWorker] Job ${job.data.jobId} done: ${result.booksDownloaded} books`);
      return result;
    },
    { connection: createRedisConnection(), concurrency: 1 }
  );

  keralaWorker.on("error", (err) => console.error("[KeralaWorker] Error:", err.message));
  console.log("[KeralaWorker] Started");
  return keralaWorker as Worker<KeralaScrapeJobData>;
}

// ---------------------------------------------------------------------------
// State Board Scrape Worker (Karnataka, TN, MH, AP/TS + NCERT mappings)
// ---------------------------------------------------------------------------

export function startStateBoardWorker(): Worker<StateBoardScrapeJobData> {
  if (stateBoardWorker) return stateBoardWorker as Worker<StateBoardScrapeJobData>;

  stateBoardWorker = new Worker<StateBoardScrapeJobData>(
    "state-board-scrape",
    async (job: Job<StateBoardScrapeJobData>) => {
      const { boardCode, jobId } = job.data;
      console.log(`[StateBoardWorker] Processing job ${jobId} for ${boardCode}`);

      // Check if this is an NCERT-aligned board (mapping, not scraping)
      const NCERT_ALIGNED = ["UP_UPMSP", "BR_BSEB", "MP_MPBSE", "RJ_RBSE", "GJ_GSEB", "CG_CGBSE", "UK_UBSE", "JH_JAC", "HR_BSEH"];

      if (NCERT_ALIGNED.includes(boardCode)) {
        const { addNCERTMappings } = await import("../scraper/ncert-board-mappings");
        const result = await addNCERTMappings(boardCode, { grades: job.data.grades });
        console.log(`[StateBoardWorker] NCERT mapping for ${boardCode}: ${result.mappingsCreated} mappings`);
        return result;
      }

      // Actual scraper dispatch
      switch (boardCode) {
        case "KA_KSEAB": {
          const { KarnatakaScraper } = await import("../scraper/karnataka-scraper");
          const scraper = new KarnatakaScraper({ rateLimitMs: 3000 });
          return await scraper.scrapeWithDetails({
            grades: job.data.grades,
            medium: job.data.medium as "english" | "kannada" | "both" | undefined,
            jobId,
            maxPdfs: job.data.maxPdfs,
            aiProvider: job.data.aiProvider,
            downloadOnly: job.data.downloadOnly,
          });
        }
        case "TN_DGE": {
          const { TamilNaduScraper } = await import("../scraper/tamilnadu-scraper");
          const scraper = new TamilNaduScraper({ rateLimitMs: 3000 });
          return await scraper.scrapeWithDetails({
            grades: job.data.grades,
            medium: job.data.medium as "english" | "tamil" | "both" | undefined,
            jobId,
            maxPdfs: job.data.maxPdfs,
            aiProvider: job.data.aiProvider,
            downloadOnly: job.data.downloadOnly,
          });
        }
        case "MH_MSBSHSE": {
          const { MaharashtraScraper } = await import("../scraper/maharashtra-scraper");
          const scraper = new MaharashtraScraper({ rateLimitMs: 3000 });
          return await scraper.scrapeWithDetails({
            grades: job.data.grades,
            medium: job.data.medium as "english" | "marathi" | "both" | undefined,
            jobId,
            maxPdfs: job.data.maxPdfs,
            aiProvider: job.data.aiProvider,
            downloadOnly: job.data.downloadOnly,
          });
        }
        case "AP_BSEAP":
        case "TS_BSETS": {
          const { APTelanganaScraper } = await import("../scraper/ap-telangana-scraper");
          const scraper = new APTelanganaScraper({ rateLimitMs: 3000 });
          return await scraper.scrapeWithDetails({
            board: job.data.board ?? (boardCode === "AP_BSEAP" ? "AP_BSEAP" : "TS_BSETS"),
            grades: job.data.grades,
            medium: job.data.medium as "english" | "telugu" | "both" | undefined,
            jobId,
            maxPdfs: job.data.maxPdfs,
            aiProvider: job.data.aiProvider,
            downloadOnly: job.data.downloadOnly,
          });
        }
        default:
          throw new Error(`No scraper for board: ${boardCode}`);
      }
    },
    { connection: createRedisConnection(), concurrency: 1 }
  );

  stateBoardWorker.on("error", (err) => console.error("[StateBoardWorker] Error:", err.message));
  console.log("[StateBoardWorker] Started");
  return stateBoardWorker as Worker<StateBoardScrapeJobData>;
}

// ---------------------------------------------------------------------------
// Content Generate Worker
// ---------------------------------------------------------------------------

export function startContentGenWorker(): Worker<ContentGenerateJobData> {
  if (contentGenWorker) return contentGenWorker as Worker<ContentGenerateJobData>;

  contentGenWorker = new Worker<ContentGenerateJobData>(
    "content-generate",
    async (job: Job<ContentGenerateJobData>) => {
      console.log(`[ContentGenWorker] Processing job ${job.data.jobId}`);
      const { bulkGenerateContent } = await import("../ai/content-generator");
      const result = await bulkGenerateContent({
        notes: job.data.notes,
        flashcards: job.data.flashcards,
        mcqs: job.data.mcqs,
        mcqCount: job.data.mcqCount,
        flashcardCount: job.data.flashcardCount,
        boardCodes: job.data.boardCodes,
        grades: job.data.grades,
        subjects: job.data.subjects,
        language: job.data.language,
        batchSize: job.data.batchSize,
        dryRun: job.data.dryRun,
      });
      console.log(`[ContentGenWorker] Job ${job.data.jobId} done: ${result.topicsProcessed} topics, $${result.totalCostUsd.toFixed(4)}`);
      return result;
    },
    { connection: createRedisConnection(), concurrency: 1 }
  );

  contentGenWorker.on("error", (err) => console.error("[ContentGenWorker] Error:", err.message));
  console.log("[ContentGenWorker] Started");
  return contentGenWorker as Worker<ContentGenerateJobData>;
}

// ---------------------------------------------------------------------------
// Start/Stop all pipeline workers
// ---------------------------------------------------------------------------

export function startAllPipelineWorkers(): void {
  startNcertWorker();
  startDikshaWorker();
  startKeralaWorker();
  startStateBoardWorker();
  startContentGenWorker();
}

export async function stopAllPipelineWorkers(): Promise<void> {
  const workers = [ncertWorker, dikshaWorker, keralaWorker, stateBoardWorker, contentGenWorker];
  await Promise.all(workers.filter(Boolean).map((w) => w!.close()));
  ncertWorker = null;
  dikshaWorker = null;
  keralaWorker = null;
  stateBoardWorker = null;
  contentGenWorker = null;
  console.log("[PipelineWorkers] All stopped");
}
