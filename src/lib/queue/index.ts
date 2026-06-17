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
  /**
   * Academic year for this scrape, formatted "YYYY-YY" (e.g. "2026-27").
   * Threaded end-to-end so the scraper hits the right per-year source URL
   * (CBSE: curriculum_YYYY.html where YYYY = end year) and the syllabus
   * inserter tags every standard/subject/chapter/topic row with the correct
   * academic year. Defaults are applied at the API boundary so older queue
   * consumers don't break.
   */
  academicYear?: string;
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
  /**
   * Academic year ("YYYY-YY") to tag the created `standards` rows with.
   * NCERT book files are year-agnostic (Math/Science PDFs stay stable
   * across sessions), but the curriculum tree we build from them is
   * year-specific — a 2026-27 bootstrap should produce a new standards
   * row rather than appending chapters onto the 2025-26 row.
   */
  academicYear?: string;
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
  /**
   * Academic year ("YYYY-YY"). Currently unused by state-board scrapers
   * (they don't call insertParsedSyllabus yet) but plumbed through now so
   * the API + queue contract won't need another revision when they do.
   */
  academicYear?: string;
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
  /** Academic year ("YYYY-YY") to tag inserted rows with. */
  academicYear?: string;
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

/**
 * Extract topic-level content from an already-downloaded CBSE textbook PDF.
 *
 * Why this exists as its own queue (instead of reusing content-generate):
 * content-generate hallucinates content from context; this one reads the
 * real PDF that was scraped from cbseacademic.nic.in. Different I/O
 * characteristics (PDF read per chapter, AI extraction per topic) and
 * different failure modes (missing PDF file, unreadable text), so it gets
 * its own queue for observability.
 *
 * Payload mirrors the /api/admin/content/fill-gaps POST body.
 */
export interface CbseContentFillJobData {
  jobId: number;
  subjectId: number;
  /** Optional whitelist — if set, only these topics are processed. */
  topicIds?: number[];
  /** Max topics processed in one job run. Server-side enforced cap of 500. */
  limit?: number;
  /** Reserved — currently all outputs are notes; kept for future expansion. */
  notes?: boolean;
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
let _cbseContentFillQueue: Queue<CbseContentFillJobData> | null = null;

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

/**
 * Queue for extracting topic-level content from a scraped CBSE textbook PDF.
 * Mirrors the ncert-download queue's knobs — 1 retry (AI tokens are expensive
 * to re-spend) with a long backoff so transient AI-provider hiccups don't
 * double-charge us.
 */
export function getCbseContentFillQueue(): Queue<CbseContentFillJobData> {
  if (!_cbseContentFillQueue) {
    _cbseContentFillQueue = new Queue<CbseContentFillJobData>(
      "cbse-content-fill",
      {
        connection: getRedisConnection(),
        defaultJobOptions: {
          attempts: 1,
          backoff: { type: "exponential", delay: 10000 },
          removeOnComplete: { count: 50 },
          removeOnFail: { count: 100 },
        },
      }
    );
  }
  return _cbseContentFillQueue;
}

export async function addCbseContentFillJob(
  data: CbseContentFillJobData
): Promise<string> {
  const queue = getCbseContentFillQueue();
  const job = await queue.add(
    `cbse-content-fill-${data.subjectId}-${data.jobId}`,
    data,
    { priority: 2 }
  );
  return job.id ?? "";
}

// ---------------------------------------------------------------------------
// Creator Content Processing Queue
// ---------------------------------------------------------------------------
export interface CreatorContentJobData {
  contentId: number;
  creatorId: number;
  action: "process_full" | "ai_summarize" | "ai_tag" | "ai_quality_check";
}

let _creatorContentQueue: Queue<CreatorContentJobData> | null = null;

export function getCreatorContentQueue(): Queue<CreatorContentJobData> {
  if (!_creatorContentQueue) {
    _creatorContentQueue = new Queue<CreatorContentJobData>(
      "creator-content-process",
      {
        connection: getRedisConnection(),
        defaultJobOptions: {
          attempts: 2,
          backoff: { type: "exponential", delay: 5000 },
          removeOnComplete: { count: 200 },
          removeOnFail: { count: 200 },
        },
      }
    );
  }
  return _creatorContentQueue;
}

export async function addCreatorContentJob(
  data: CreatorContentJobData
): Promise<string> {
  const queue = getCreatorContentQueue();
  const job = await queue.add(
    `process-${data.contentId}`,
    data,
    { priority: 3 }
  );
  return job.id ?? "";
}

// ---------------------------------------------------------------------------
// School Import Queue
// ---------------------------------------------------------------------------
export interface SchoolImportJobData {
  source: string;
  stateFilter?: string;
  csvPath?: string;
}

let _schoolImportQueue: Queue<SchoolImportJobData> | null = null;

export function getSchoolImportQueue(): Queue<SchoolImportJobData> {
  if (!_schoolImportQueue) {
    _schoolImportQueue = new Queue<SchoolImportJobData>(
      "import-schools",
      {
        connection: getRedisConnection(),
        defaultJobOptions: {
          attempts: 2,
          backoff: { type: "exponential", delay: 10000 },
          removeOnComplete: { count: 50 },
          removeOnFail: { count: 50 },
        },
      }
    );
  }
  return _schoolImportQueue;
}

export async function addSchoolImportJob(data: SchoolImportJobData): Promise<string> {
  const queue = getSchoolImportQueue();
  const job = await queue.add(`import-${data.source}`, data, { priority: 5 });
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
