/**
 * Base scraper with retry logic, rate limiting, and structured error handling.
 * All board scrapers extend this class.
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { scrapeJobs } from "@/db/schema/system";

export interface ScrapeResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  url: string;
  durationMs: number;
  retries: number;
}

export interface ScraperConfig {
  /** Max retries per request */
  maxRetries: number;
  /** Base delay between retries in ms (exponential backoff) */
  retryDelayMs: number;
  /** Minimum delay between consecutive requests in ms */
  rateLimitMs: number;
  /** Request timeout in ms */
  timeoutMs: number;
  /** User-agent string */
  userAgent: string;
}

const DEFAULT_CONFIG: ScraperConfig = {
  maxRetries: 3,
  retryDelayMs: 1000,
  rateLimitMs: 2000,
  timeoutMs: 30000,
  userAgent:
    "Mozilla/5.0 (compatible; PadvikBot/1.0; +https://padvik.in/bot; educational-content)",
};

export abstract class BaseScraper {
  abstract name: string;
  abstract boardCode: string;

  protected config: ScraperConfig;
  private lastRequestTime = 0;

  constructor(config?: Partial<ScraperConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Main entry point — subclasses implement this.
   * Returns number of items processed.
   */
  abstract scrape(options?: Record<string, unknown>): Promise<number>;

  /**
   * Fetch a URL with retry logic, rate limiting, and timeout.
   */
  protected async fetch(url: string): Promise<ScrapeResult<Buffer>> {
    const start = Date.now();
    let lastError = "";

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      // Rate limiting
      await this.rateLimit();

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

        const response = await globalThis.fetch(url, {
          headers: {
            "User-Agent": this.config.userAgent,
            Accept: "*/*",
          },
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!response.ok) {
          lastError = `HTTP ${response.status}: ${response.statusText}`;
          if (response.status === 429 || response.status >= 500) {
            // Retry on rate limit or server errors
            await this.backoff(attempt);
            continue;
          }
          // Client errors (4xx except 429) — don't retry
          return {
            success: false,
            error: lastError,
            url,
            durationMs: Date.now() - start,
            retries: attempt,
          };
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        return {
          success: true,
          data: buffer,
          url,
          durationMs: Date.now() - start,
          retries: attempt,
        };
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        if (attempt < this.config.maxRetries) {
          await this.backoff(attempt);
        }
      }
    }

    return {
      success: false,
      error: `Failed after ${this.config.maxRetries + 1} attempts: ${lastError}`,
      url,
      durationMs: Date.now() - start,
      retries: this.config.maxRetries,
    };
  }

  /**
   * Fetch and return text content.
   */
  protected async fetchText(url: string): Promise<ScrapeResult<string>> {
    const result = await this.fetch(url);
    if (!result.success || !result.data) {
      return { ...result, data: undefined };
    }
    return { ...result, data: result.data.toString("utf-8") };
  }

  /**
   * Fetch and return a PDF as a Buffer.
   */
  protected async fetchPdf(url: string): Promise<ScrapeResult<Buffer>> {
    return this.fetch(url);
  }

  /**
   * Rate limiting — ensure minimum delay between requests.
   */
  private async rateLimit(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < this.config.rateLimitMs) {
      await sleep(this.config.rateLimitMs - elapsed);
    }
    this.lastRequestTime = Date.now();
  }

  /**
   * Exponential backoff with jitter.
   */
  private async backoff(attempt: number): Promise<void> {
    const base = this.config.retryDelayMs * Math.pow(2, attempt);
    const jitter = Math.random() * base * 0.3;
    await sleep(base + jitter);
  }

  /**
   * Log a message with the scraper name prefix.
   */
  protected log(message: string): void {
    console.log(`[${this.name}] ${message}`);
  }

  protected logError(message: string, err?: unknown): void {
    const detail = err instanceof Error ? err.message : String(err ?? "");
    console.error(`[${this.name}] ERROR: ${message}${detail ? ` — ${detail}` : ""}`);
  }

  /**
   * Update a scrape job record in the database.
   */
  protected async updateJob(
    jobId: number,
    updates: Partial<{
      status: string;
      itemsFound: number;
      itemsProcessed: number;
      errorLog: string;
    }>
  ): Promise<void> {
    const values: Record<string, unknown> = {};
    if (updates.status) values.status = updates.status;
    if (updates.itemsFound !== undefined) values.itemsFound = updates.itemsFound;
    if (updates.itemsProcessed !== undefined) values.itemsProcessed = updates.itemsProcessed;
    if (updates.errorLog) values.errorLog = updates.errorLog;
    if (updates.status === "running") values.startedAt = new Date();
    if (updates.status === "completed" || updates.status === "failed") {
      values.completedAt = new Date();
    }

    await db
      .update(scrapeJobs)
      .set(values)
      .where(eq(scrapeJobs.id, jobId));
  }

  /**
   * Update job metadata JSONB (merge with existing).
   * Used to store scrape results, resume state, etc.
   */
  protected async updateJobMetadata(
    jobId: number,
    newMeta: Record<string, unknown>
  ): Promise<void> {
    try {
      const [job] = await db
        .select({ metadata: scrapeJobs.metadata })
        .from(scrapeJobs)
        .where(eq(scrapeJobs.id, jobId))
        .limit(1);

      const existing = (job?.metadata as Record<string, unknown>) ?? {};
      await db
        .update(scrapeJobs)
        .set({ metadata: { ...existing, ...newMeta } })
        .where(eq(scrapeJobs.id, jobId));
    } catch (err) {
      this.logError("Failed to update job metadata", err);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
