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
  | "sarvam"
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

export interface NcertDownloadJobData {
  jobId: number;
  grades?: number[];
  subjects?: string[];
  languages?: ("en" | "hi")[];
  aiProvider?: AIProviderChoice;
  maxChapters?: number;
  downloadOnly?: boolean;
}

export interface ContentGenerateJobData {
  jobId: number;
  notes?: boolean;
  flashcards?: boolean;
  mcqs?: boolean;
  mcqCount?: number;
  flashcardCount?: number;
  boardCodes?: string[];
  grades?: number[];
  subjects?: string[];
  language?: string;
  batchSize?: number;
  dryRun?: boolean;
}

export interface StateBoardScrapeJobData {
  jobId: number;
  boardCode: string;
  grades?: number[];
  medium?: string;
  subjectFilter?: string;
  aiProvider?: AIProviderChoice;
  maxPdfs?: number;
  downloadOnly?: boolean;
  /** For AP/Telangana — which board to scrape */
  board?: "AP_BSEAP" | "TS_BSETS" | "both";
}

export interface NCERTMappingJobData {
  jobId: number;
  boardCode: string;
  grades?: number[];
}

export interface KeralaScrapeJobData {
  jobId: number;
  classStart: number;
  classEnd: number;
  medium: "english" | "malayalam" | "both";
  subjectFilter?: string;
  aiProvider?: AIProviderChoice;
  maxBooks?: number;
  downloadOnly?: boolean;
  useDikshaDiscovery?: boolean;
}

export interface DikshaIngestJobData {
  jobId: number;
  boardCode: string;
  gradeStart: number;
  gradeEnd: number;
  subjectFilter?: string;
  medium?: string;
}

export interface NotificationScrapeJobData {
  boardCode?: string;
}

export interface FoundationGenerateJobData {
  topicIds?: number[];
  boardCodes?: string[];
  grades?: number[];
  batchSize?: number;
  dryRun?: boolean;
}

// ---------------------------------------------------------------------------
// Queue instances (lazy-initialized singletons)
// ---------------------------------------------------------------------------
let _scrapeQueue: Queue<ScrapeJobData> | null = null;
let _contentQueue: Queue<ContentJobData> | null = null;
let _fileQueue: Queue<FileJobData> | null = null;
let _dikshaQueue: Queue<DikshaIngestJobData> | null = null;
let _keralaQueue: Queue<KeralaScrapeJobData> | null = null;
let _stateBoardQueue: Queue<StateBoardScrapeJobData> | null = null;
let _contentGenQueue: Queue<ContentGenerateJobData> | null = null;
let _ncertQueue: Queue<NcertDownloadJobData> | null = null;
let _notificationQueue: Queue<NotificationScrapeJobData> | null = null;
let _foundationQueue: Queue<FoundationGenerateJobData> | null = null;

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

export function getNcertQueue(): Queue<NcertDownloadJobData> {
  if (!_ncertQueue) {
    _ncertQueue = new Queue<NcertDownloadJobData>("ncert-download", {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: "exponential", delay: 10000 },
        removeOnComplete: { count: 50 },
        removeOnFail: { count: 100 },
      },
    });
  }
  return _ncertQueue;
}

export function getContentGenQueue(): Queue<ContentGenerateJobData> {
  if (!_contentGenQueue) {
    _contentGenQueue = new Queue<ContentGenerateJobData>("content-generate", {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: 1, // Don't retry AI generation — wastes tokens
        removeOnComplete: { count: 50 },
        removeOnFail: { count: 100 },
      },
    });
  }
  return _contentGenQueue;
}

export function getStateBoardQueue(): Queue<StateBoardScrapeJobData> {
  if (!_stateBoardQueue) {
    _stateBoardQueue = new Queue<StateBoardScrapeJobData>("state-board-scrape", {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: "exponential", delay: 10000 },
        removeOnComplete: { count: 50 },
        removeOnFail: { count: 100 },
      },
    });
  }
  return _stateBoardQueue;
}

export function getKeralaQueue(): Queue<KeralaScrapeJobData> {
  if (!_keralaQueue) {
    _keralaQueue = new Queue<KeralaScrapeJobData>("kerala-scrape", {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: "exponential", delay: 10000 },
        removeOnComplete: { count: 50 },
        removeOnFail: { count: 100 },
      },
    });
  }
  return _keralaQueue;
}

export function getDikshaQueue(): Queue<DikshaIngestJobData> {
  if (!_dikshaQueue) {
    _dikshaQueue = new Queue<DikshaIngestJobData>("diksha-ingest", {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: "exponential", delay: 10000 },
        removeOnComplete: { count: 50 },
        removeOnFail: { count: 100 },
      },
    });
  }
  return _dikshaQueue;
}

export function getNotificationQueue(): Queue<NotificationScrapeJobData> {
  if (!_notificationQueue) {
    _notificationQueue = new Queue<NotificationScrapeJobData>(
      "notification-scrape",
      {
        connection: getRedisConnection(),
        defaultJobOptions: {
          attempts: 2,
          backoff: { type: "exponential", delay: 10000 },
          removeOnComplete: { count: 50 },
          removeOnFail: { count: 100 },
        },
      }
    );
  }
  return _notificationQueue;
}

export function getFoundationQueue(): Queue<FoundationGenerateJobData> {
  if (!_foundationQueue) {
    _foundationQueue = new Queue<FoundationGenerateJobData>(
      "foundation-generate",
      {
        connection: getRedisConnection(),
        defaultJobOptions: {
          attempts: 1, // Don't retry AI generation — wastes tokens
          removeOnComplete: { count: 50 },
          removeOnFail: { count: 100 },
        },
      }
    );
  }
  return _foundationQueue;
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

export async function addNcertDownloadJob(data: NcertDownloadJobData): Promise<string> {
  const queue = getNcertQueue();
  const gradesStr = data.grades?.join("-") ?? "all";
  const job = await queue.add(
    `ncert-download-${gradesStr}-${data.jobId}`,
    data,
    { priority: 1 }
  );
  return job.id ?? "";
}

export async function addContentGenerateJob(data: ContentGenerateJobData): Promise<string> {
  const queue = getContentGenQueue();
  const job = await queue.add(
    `content-gen-${data.jobId}`,
    data,
    { priority: 5 } // Lower priority than scraping
  );
  return job.id ?? "";
}

export async function addStateBoardScrapeJob(data: StateBoardScrapeJobData): Promise<string> {
  const queue = getStateBoardQueue();
  const job = await queue.add(
    `state-board-${data.boardCode}-${data.jobId}`,
    data,
    { priority: 3 }
  );
  return job.id ?? "";
}

export async function addKeralaScrapeJob(data: KeralaScrapeJobData): Promise<string> {
  const queue = getKeralaQueue();
  const job = await queue.add(
    `kerala-scrape-${data.classStart}-${data.classEnd}-${data.medium}`,
    data,
    { priority: 2 }
  );
  return job.id ?? "";
}

export async function addDikshaIngestJob(data: DikshaIngestJobData): Promise<string> {
  const queue = getDikshaQueue();
  const job = await queue.add(
    `diksha-ingest-${data.boardCode}-${data.gradeStart}-${data.gradeEnd}`,
    data,
    { priority: data.boardCode === "CBSE" ? 1 : 2 }
  );
  return job.id ?? "";
}

export async function addNotificationScrapeJob(
  data: NotificationScrapeJobData = {}
): Promise<string> {
  const queue = getNotificationQueue();
  const job = await queue.add(
    `notification-scrape-${data.boardCode ?? "all"}`,
    data,
    { priority: 5 }
  );
  return job.id ?? "";
}

/**
 * Register the recurring notification scrape cron job.
 * Should be called once at worker startup.
 */
export async function registerNotificationCron(): Promise<void> {
  const queue = getNotificationQueue();
  // Remove any existing repeatable jobs first
  const existing = await queue.getRepeatableJobs();
  for (const job of existing) {
    await queue.removeRepeatableByKey(job.key);
  }
  // Every 3 hours
  await queue.add("scrape-notifications-cron", {}, {
    repeat: { pattern: "0 */3 * * *" },
    priority: 5,
  });
  console.log("[NotificationQueue] Registered cron: every 3 hours");
}

export async function addFoundationJob(
  data: FoundationGenerateJobData = {}
): Promise<string> {
  const queue = getFoundationQueue();
  const job = await queue.add(
    `foundation-gen-${Date.now()}`,
    data,
    { priority: 5 }
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
