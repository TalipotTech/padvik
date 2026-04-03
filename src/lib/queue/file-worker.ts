/**
 * BullMQ worker for file upload processing.
 * Handles text extraction and processing of uploaded files.
 *
 * Currently a minimal implementation — will be expanded when
 * the file upload pipeline is built.
 */
import { Worker, Job } from "bullmq";
import { getRedisConnection } from "../redis";
import type { FileJobData } from "./index";

let worker: Worker<FileJobData> | null = null;

export function startFileWorker(): Worker<FileJobData> {
  if (worker) return worker;

  worker = new Worker<FileJobData>(
    "file",
    async (job: Job<FileJobData>) => {
      const { fileUploadId, action } = job.data;
      console.log(`[FileWorker] Processing file ${fileUploadId}, action: ${action}`);

      // TODO: Implement file processing when S3 upload pipeline is built
      // - extract_text: Download from S3, extract text (PDF/image OCR)
      // - process: Run AI tagging, content extraction
      console.log(`[FileWorker] File processing not yet implemented for action: ${action}`);
    },
    {
      connection: getRedisConnection(),
      concurrency: 3,
    }
  );

  worker.on("error", (err) => {
    console.error("[FileWorker] Worker error:", err.message);
  });

  console.log("[FileWorker] Started and waiting for jobs...");
  return worker;
}

export async function stopFileWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
    console.log("[FileWorker] Stopped.");
  }
}
