/**
 * BullMQ worker for notification scraping jobs.
 * Processes both cron-triggered and manually-triggered scrape jobs.
 */
import { Worker, type Job } from "bullmq";
import { createRedisConnection } from "../redis";
import type { NotificationScrapeJobData } from "./index";
import { scrapeNotifications } from "../scraper/notification-scraper";

export function startNotificationWorker(): Worker<NotificationScrapeJobData> {
  const worker = new Worker<NotificationScrapeJobData>(
    "notification-scrape",
    async (job: Job<NotificationScrapeJobData>) => {
      const { boardCode } = job.data;
      console.log(
        `[NotificationWorker] Starting scrape${boardCode ? ` for ${boardCode}` : " (all boards)"}`
      );

      const result = await scrapeNotifications(boardCode);

      console.log(
        `[NotificationWorker] Done: ${result.new} new / ${result.scraped} scraped, ${result.errors.length} errors`
      );

      if (result.errors.length > 0) {
        console.warn(
          "[NotificationWorker] Errors:",
          result.errors.join("; ")
        );
      }

      return result;
    },
    {
      connection: createRedisConnection(),
      concurrency: 1,
    }
  );

  worker.on("failed", (job, err) => {
    console.error(
      `[NotificationWorker] Job ${job?.id} failed:`,
      err.message
    );
  });

  return worker;
}
