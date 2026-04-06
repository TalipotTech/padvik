/**
 * BullMQ queue definitions for the scraping and content pipelines.
 */
import { Queue } from "bullmq";
import { getRedisConnection } from "../redis";

// ---------------------------------------------------------------------------
// AI provider types
// ---------------------------------------------------------------------------
export type AIProviderChoice =
  | "anthropic"
  | "gemini"
  | "mistral"
  | "openai"
  | "perplexity"
  | "auto";

// ---------------------------------------------------------------------------
// Job data interfaces
// ---------------------------------------------------------------------------
export interface ScrapeJobData {
  jobId: number;
  boardCode: string;
  jobType: string;
  grades?: number[];
  maxPdfs?: number;
  aiProvider?: AIProviderChoice;
  /** When true, only re-process PDFs that failed or were skipped in a previous run */
  retrySkipped?: boolean;
}

export interface ContentJobData {
  scrapeJobId: number;
  entityType: "subject" | "chapter" | "topic";
  entityId: number;
  action: "quality_score" | "ai_tag";
}

export interface FileJobData {
  fileUploadId: number;
  action: "extract_text" | "process";
}

// ---------------------------------------------------------------------------
// Queue instances (lazy-initialized singletons)
// ---------------------------------------------------------------------------
let _scrapeQueue: Queue<ScrapeJobData> | null = null;
let _contentQueue: Queue<ContentJobData> | null = null;
let _fileQueue: Queue<FileJobData> | null = null;

export function getScrapeQueue(): Queue<ScrapeJobData> {
  if (!_scrapeQueue) {
    _scrapeQueue = new Queue<ScrapeJobData>("scrape", {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 200 },
      },
    });
  }
  return _scrapeQueue;
}

export function getContentQueue(): Queue<ContentJobData> {
  if (!_contentQueue) {
    _contentQueue = new Queue<ContentJobData>("content", {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: "exponential", delay: 3000 },
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 200 },
      },
    });
  }
  return _contentQueue;
}

export function getFileQueue(): Queue<FileJobData> {
  if (!_fileQueue) {
    _fileQueue = new Queue<FileJobData>("file", {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 200 },
      },
    });
  }
  return _fileQueue;
}

// ---------------------------------------------------------------------------
// Helper functions to add jobs
// ---------------------------------------------------------------------------
export async function addScrapeJob(data: ScrapeJobData): Promise<string> {
  const queue = getScrapeQueue();
  const job = await queue.add(`scrape-${data.boardCode}-${data.jobId}`, data, {
    priority: data.boardCode === "CBSE" ? 1 : 2,
  });
  return job.id ?? "";
}

export async function addContentJob(data: ContentJobData): Promise<string> {
  const queue = getContentQueue();
  const job = await queue.add(
    `${data.action}-${data.entityType}-${data.entityId}`,
    data
  );
  return job.id ?? "";
}

export async function addFileJob(data: FileJobData): Promise<string> {
  const queue = getFileQueue();
  const job = await queue.add(
    `${data.action}-${data.fileUploadId}`,
    data
  );
  return job.id ?? "";
}

// ---------------------------------------------------------------------------
// Queue control helpers
// ---------------------------------------------------------------------------
export async function pauseScrapeQueue(): Promise<void> {
  await getScrapeQueue().pause();
}

export async function resumeScrapeQueue(): Promise<void> {
  await getScrapeQueue().resume();
}

export async function cancelScrapeJob(queueJobId: string): Promise<boolean> {
  const queue = getScrapeQueue();
  const job = await queue.getJob(queueJobId);
  if (!job) return false;

  const state = await job.getState();
  if (state === "active") {
    await job.moveToFailed(new Error("Cancelled by admin"), "0", true);
  } else if (state === "waiting" || state === "delayed") {
    await job.remove();
  }
  return true;
}

export async function removeScrapeJob(queueJobId: string): Promise<boolean> {
  const queue = getScrapeQueue();
  const job = await queue.getJob(queueJobId);
  if (!job) return false;
  await job.remove();
  return true;
}
