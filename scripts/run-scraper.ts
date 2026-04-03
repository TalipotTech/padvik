/**
 * CLI scraper trigger
 *
 * Usage:
 *   pnpm scrape --board cbse                      # Scrape all CBSE PDFs
 *   pnpm scrape --board cbse --grades 9,10         # Specific grades
 *   pnpm scrape --board cbse --max-pdfs 5          # Limit PDFs
 *   pnpm scrape --board icse --queue               # Enqueue via BullMQ
 *   pnpm scrape --board kerala                     # Kerala SCERT
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config(); // Also try .env as fallback

import { CbseScraper } from "../src/lib/scraper/cbse-scraper";
import { IcseScraper } from "../src/lib/scraper/icse-scraper";
import { KeralaScraper } from "../src/lib/scraper/kerala-scraper";
import type { BaseScraper } from "../src/lib/scraper/base-scraper";

// ---------------------------------------------------------------------------
// Parse CLI arguments
// ---------------------------------------------------------------------------
function parseArgs(): {
  board: string;
  grades?: number[];
  maxPdfs?: number;
  queue: boolean;
} {
  const args = process.argv.slice(2);
  let board = "";
  let grades: number[] | undefined;
  let maxPdfs: number | undefined;
  let queue = false;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--board":
        board = (args[++i] ?? "").toUpperCase();
        break;
      case "--grades":
        grades = (args[++i] ?? "")
          .split(",")
          .map((s) => parseInt(s.trim(), 10))
          .filter((n) => n >= 1 && n <= 12);
        break;
      case "--max-pdfs":
        maxPdfs = parseInt(args[++i] ?? "0", 10) || undefined;
        break;
      case "--queue":
        queue = true;
        break;
      case "--help":
      case "-h":
        printUsage();
        process.exit(0);
    }
  }

  // Normalize board aliases
  const boardAliases: Record<string, string> = {
    CBSE: "CBSE",
    ICSE: "ICSE",
    ISC: "ICSE",
    KERALA: "KL_SCERT",
    KL_SCERT: "KL_SCERT",
    KL: "KL_SCERT",
  };
  board = boardAliases[board] ?? board;

  if (!board) {
    console.error("Error: --board is required\n");
    printUsage();
    process.exit(1);
  }

  return { board, grades, maxPdfs, queue };
}

function printUsage(): void {
  console.log(`
Padvik Scraper CLI

Usage: pnpm scrape --board <board> [options]

Boards:
  cbse        CBSE (cbseacademic.nic.in)
  icse        ICSE/ISC (cisce.org)
  kerala      Kerala SCERT (scert.kerala.gov.in)

Options:
  --board     Board to scrape (required)
  --grades    Comma-separated grades, e.g., 9,10,11
  --max-pdfs  Maximum PDFs to process (default: all)
  --queue     Enqueue via BullMQ instead of running directly
  --help      Show this help message

Examples:
  pnpm scrape --board cbse --max-pdfs 3
  pnpm scrape --board icse --grades 10,11,12
  pnpm scrape --board kerala --queue
`);
}

function createScraper(boardCode: string): BaseScraper {
  switch (boardCode) {
    case "CBSE":
      return new CbseScraper({ rateLimitMs: 3000 });
    case "ICSE":
      return new IcseScraper({ rateLimitMs: 3000 });
    case "KL_SCERT":
      return new KeralaScraper({ rateLimitMs: 3000 });
    default:
      console.error(`Unknown board: ${boardCode}`);
      process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  const { board, grades, maxPdfs, queue } = parseArgs();

  console.log(`\nPadvik Scraper`);
  console.log(`Board: ${board}`);
  if (grades) console.log(`Grades: ${grades.join(", ")}`);
  if (maxPdfs) console.log(`Max PDFs: ${maxPdfs}`);
  console.log(`Mode: ${queue ? "Queue (BullMQ)" : "Direct"}\n`);

  if (queue) {
    // Queue mode: create a local drizzle instance and insert + enqueue
    const postgres = (await import("postgres")).default;
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const { scrapeJobs } = await import("../src/db/schema/system");

    const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
    const localDb = drizzle(sql);

    const [job] = await localDb
      .insert(scrapeJobs)
      .values({
        jobType: "syllabus",
        sourceUrl: `cli-trigger-${board}`,
        status: "queued",
      })
      .returning();

    const { addScrapeJob } = await import("../src/lib/queue");
    const queueJobId = await addScrapeJob({
      jobId: job.id,
      boardCode: board,
      jobType: "syllabus",
      grades,
      maxPdfs,
    });

    console.log(`Job enqueued successfully!`);
    console.log(`  DB Job ID: ${job.id}`);
    console.log(`  Queue Job ID: ${queueJobId}`);
    console.log(`\nMake sure workers are running: pnpm workers`);

    const { closeRedis } = await import("../src/lib/redis");
    await closeRedis();
    await sql.end();
  } else {
    // Direct mode: run scraper in-process WITH job tracking in DB
    const { db } = await import("../src/db");
    const { scrapeJobs } = await import("../src/db/schema/system");
    const { eq } = await import("drizzle-orm");

    const BOARD_URLS: Record<string, string> = {
      CBSE: "https://cbseacademic.nic.in/curriculum_2026.html",
      ICSE: "https://www.cisce.org/regulations-syllabi",
      KL_SCERT: "https://scert.kerala.gov.in/curriculum",
    };

    // Create job record so it shows in admin UI
    const [job] = await db
      .insert(scrapeJobs)
      .values({
        jobType: "syllabus",
        sourceUrl: BOARD_URLS[board] ?? `cli-${board}`,
        status: "running",
        startedAt: new Date(),
        metadata: {
          boardCode: board,
          aiProvider: "auto",
          grades: grades ?? null,
          maxPdfs: maxPdfs ?? null,
          triggeredBy: "cli",
          triggeredAt: new Date().toISOString(),
        },
      })
      .returning();

    console.log(`Created job #${job.id} in database`);

    const scraper = createScraper(board);
    const startTime = Date.now();

    try {
      const processed = await scraper.scrape({ grades, maxPdfs, jobId: job.id });
      const duration = Math.round((Date.now() - startTime) / 1000);

      // Mark completed
      await db
        .update(scrapeJobs)
        .set({
          status: "completed",
          completedAt: new Date(),
          itemsProcessed: processed,
        })
        .where(eq(scrapeJobs.id, job.id));

      console.log(`\nDone! Processed ${processed} PDFs in ${duration}s (Job #${job.id})`);
    } catch (err) {
      // Mark failed
      await db
        .update(scrapeJobs)
        .set({
          status: "failed",
          completedAt: new Date(),
          errorLog: err instanceof Error ? err.message : String(err),
        })
        .where(eq(scrapeJobs.id, job.id));

      console.error("\nScrape failed:", err instanceof Error ? err.message : err);
      process.exit(1);
    }
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
