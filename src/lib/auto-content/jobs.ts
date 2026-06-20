/**
 * BullMQ wiring for the auto-content pipeline.
 *
 * Two queues:
 *   - "auto-content-schedule" — repeatable cron jobs (demand scoring, the
 *     generation cycle, monthly signal cleanup). Job name selects the task.
 *   - "auto-content-process"  — one-off jobs that run a single auto_content_jobs
 *     row through its generator + publisher. Triggered by the orchestrator or an
 *     admin API. Retries 3× with a 1m → 5m → 15m backoff.
 *
 * Follows the conventions in src/lib/queue (lazy queue singletons, Worker with
 * createRedisConnection, start/stop helpers, cron registered as repeatable jobs).
 */
import { Queue, Worker, UnrecoverableError, type Job } from "bullmq";
import { getRedisConnection, createRedisConnection } from "@/lib/redis";
import { calculateDemandScores, cleanupOldSignals } from "./demand-tracker";
import {
  runContentGenerationCycle,
  processAutoContentJob,
  TerminalGenerationError,
} from "./orchestrator";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const SCHEDULE_QUEUE = "auto-content-schedule";
const PROCESS_QUEUE = "auto-content-process";

const SIGNALS_RETENTION_DAYS = 90;

// process-auto-content backoff stages (ms): 1 min → 5 min → 15 min
const PROCESS_BACKOFF_MS = [60_000, 300_000, 900_000];

// Job timeouts (BullMQ has no built-in per-job timeout — enforced via withTimeout)
const CYCLE_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2 hours
const PROCESS_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

// Cron schedules
const CRON = {
  calculateDemand: "0 2 * * *", // daily 02:00
  generationCycle: "0 4 * * *", // daily 04:00
  cleanupSignals: "0 3 1 * *", // 1st of month, 03:00
} as const;

// Schedule job names (also used as the repeatable job names)
type ScheduleTask = "calculate-demand-scores" | "content-generation-cycle" | "cleanup-demand-signals";

export interface ProcessAutoContentJobData {
  jobId: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/** Reject if `promise` doesn't settle within `ms`. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

// ---------------------------------------------------------------------------
// Queues (lazy singletons)
// ---------------------------------------------------------------------------
let _scheduleQueue: Queue | null = null;
let _processQueue: Queue<ProcessAutoContentJobData> | null = null;

export function getAutoContentScheduleQueue(): Queue {
  if (!_scheduleQueue) {
    _scheduleQueue = new Queue(SCHEDULE_QUEUE, {
      connection: getRedisConnection(),
      defaultJobOptions: {
        removeOnComplete: { count: 50 },
        removeOnFail: { count: 100 },
      },
    });
  }
  return _scheduleQueue;
}

export function getAutoContentProcessQueue(): Queue<ProcessAutoContentJobData> {
  if (!_processQueue) {
    _processQueue = new Queue<ProcessAutoContentJobData>(PROCESS_QUEUE, {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "autoContent" }, // custom strategy, see worker settings
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 200 },
      },
    });
  }
  return _processQueue;
}

/** Enqueue a single auto_content_jobs row for processing. */
export async function addProcessAutoContentJob(jobId: number): Promise<string> {
  const queue = getAutoContentProcessQueue();
  const job = await queue.add(`process-auto-content-${jobId}`, { jobId }, { priority: 3 });
  return job.id ?? "";
}

// ---------------------------------------------------------------------------
// Cron registration
// ---------------------------------------------------------------------------
/**
 * Register (idempotently) the three recurring schedule jobs. Call once at
 * worker startup.
 */
export async function registerAutoContentCrons(): Promise<void> {
  const queue = getAutoContentScheduleQueue();

  // Clear any previously registered repeatables so schedule changes take effect
  const existing = await queue.getRepeatableJobs();
  for (const job of existing) {
    await queue.removeRepeatableByKey(job.key);
  }

  await queue.add(
    "calculate-demand-scores" satisfies ScheduleTask,
    {},
    { repeat: { pattern: CRON.calculateDemand } }
  );
  await queue.add(
    "content-generation-cycle" satisfies ScheduleTask,
    {},
    { repeat: { pattern: CRON.generationCycle } }
  );
  await queue.add(
    "cleanup-demand-signals" satisfies ScheduleTask,
    {},
    { repeat: { pattern: CRON.cleanupSignals } }
  );

  console.log(
    `[auto-content] Registered crons: demand=${CRON.calculateDemand}, cycle=${CRON.generationCycle}, cleanup=${CRON.cleanupSignals}`
  );
}

// ---------------------------------------------------------------------------
// Workers
// ---------------------------------------------------------------------------
let _scheduleWorker: Worker | null = null;
let _processWorker: Worker<ProcessAutoContentJobData> | null = null;

export function startAutoContentScheduleWorker(): Worker {
  if (_scheduleWorker) return _scheduleWorker;

  _scheduleWorker = new Worker(
    SCHEDULE_QUEUE,
    async (job: Job) => {
      const task = job.name as ScheduleTask;
      console.log(`[auto-content:schedule] Running "${task}"`);

      switch (task) {
        case "calculate-demand-scores": {
          const scores = await calculateDemandScores();
          console.log(`[auto-content:schedule] Demand scored for ${scores.length} topics`);
          return { topics: scores.length };
        }
        case "content-generation-cycle": {
          const result = await withTimeout(
            runContentGenerationCycle(),
            CYCLE_TIMEOUT_MS,
            "content-generation-cycle"
          );
          return result;
        }
        case "cleanup-demand-signals": {
          const deleted = await cleanupOldSignals(SIGNALS_RETENTION_DAYS);
          console.log(`[auto-content:schedule] Cleaned up ${deleted} old demand signals`);
          return { deleted };
        }
        default:
          throw new Error(`Unknown schedule task: ${task}`);
      }
    },
    {
      connection: createRedisConnection(),
      concurrency: 1, // schedule tasks run one at a time
    }
  );

  _scheduleWorker.on("failed", (job, err) => {
    console.error(`[auto-content:schedule] Job ${job?.name} failed:`, err.message);
  });

  console.log("[auto-content:schedule] Worker started");
  return _scheduleWorker;
}

export function startAutoContentProcessWorker(): Worker<ProcessAutoContentJobData> {
  if (_processWorker) return _processWorker;

  _processWorker = new Worker<ProcessAutoContentJobData>(
    PROCESS_QUEUE,
    async (job: Job<ProcessAutoContentJobData>) => {
      const { jobId } = job.data;
      try {
        await withTimeout(
          processAutoContentJob(BigInt(jobId)),
          PROCESS_TIMEOUT_MS,
          `process-auto-content-${jobId}`
        );
      } catch (err) {
        // Auth/credit/validation errors won't fix on retry — stop immediately.
        if (err instanceof TerminalGenerationError) {
          throw new UnrecoverableError(err.message);
        }
        throw err;
      }
    },
    {
      connection: createRedisConnection(),
      concurrency: 2,
      limiter: {
        max: 10,
        duration: 60_000, // stay within AI rate limits
      },
      settings: {
        // 1 min → 5 min → 15 min, then hold at 15 min
        backoffStrategy: (attemptsMade: number) =>
          PROCESS_BACKOFF_MS[attemptsMade - 1] ?? PROCESS_BACKOFF_MS[PROCESS_BACKOFF_MS.length - 1],
      },
    }
  );

  _processWorker.on("failed", (job, err) => {
    console.error(`[auto-content:process] Job ${job?.id} failed:`, err.message);
  });

  console.log("[auto-content:process] Worker started");
  return _processWorker;
}

/** Start both workers and register the cron schedule. */
export async function startAutoContentWorkers(): Promise<void> {
  startAutoContentScheduleWorker();
  startAutoContentProcessWorker();
  await registerAutoContentCrons();
}

export async function stopAutoContentWorkers(): Promise<void> {
  await Promise.all([
    _scheduleWorker?.close(),
    _processWorker?.close(),
  ]);
  _scheduleWorker = null;
  _processWorker = null;
  console.log("[auto-content] Workers stopped");
}
