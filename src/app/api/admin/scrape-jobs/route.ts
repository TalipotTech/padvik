import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { scrapeJobs } from "@/db/schema/system";
import { desc, eq } from "drizzle-orm";
import { CbseScraper } from "@/lib/scraper/cbse-scraper";
import { z } from "zod/v4";

// ---------------------------------------------------------------------------
// GET /api/admin/scrape-jobs — List scrape jobs
// ---------------------------------------------------------------------------
export async function GET() {
  const session = await auth();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Admin access required" } },
      { status: 403 }
    );
  }

  const jobs = await db
    .select()
    .from(scrapeJobs)
    .orderBy(desc(scrapeJobs.createdAt))
    .limit(50);

  return NextResponse.json({ success: true, data: jobs });
}

// ---------------------------------------------------------------------------
// POST /api/admin/scrape-jobs — Trigger a new scrape job
// ---------------------------------------------------------------------------
const createJobSchema = z.object({
  boardCode: z.string().min(1),
  jobType: z.enum(["syllabus", "question_paper", "textbook"]),
  grades: z.array(z.number().int().min(1).max(12)).optional(),
  maxPdfs: z.number().int().min(1).max(100).optional(),
});

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Admin access required" } },
      { status: 403 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "INVALID_JSON", message: "Invalid JSON body" } },
      { status: 400 }
    );
  }

  const parsed = createJobSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message },
      },
      { status: 400 }
    );
  }

  const { boardCode, jobType, grades, maxPdfs } = parsed.data;

  // Only CBSE scraper is implemented for now
  if (boardCode !== "CBSE") {
    return NextResponse.json(
      {
        success: false,
        error: { code: "NOT_IMPLEMENTED", message: `Scraper for ${boardCode} not implemented yet` },
      },
      { status: 400 }
    );
  }

  // Create the job record
  const [job] = await db
    .insert(scrapeJobs)
    .values({
      jobType,
      sourceUrl: "https://cbseacademic.nic.in/curriculum_2026.html",
      boardId: null, // Will be resolved by scraper
      status: "queued",
    })
    .returning();

  // Run the scraper asynchronously (non-blocking)
  runScrapeJob(job.id, { grades, maxPdfs }).catch((err) => {
    console.error(`Scrape job ${job.id} failed:`, err);
  });

  return NextResponse.json({ success: true, data: job }, { status: 201 });
}

// ---------------------------------------------------------------------------
// Background scraper runner
// ---------------------------------------------------------------------------
async function runScrapeJob(
  jobId: number,
  options: { grades?: number[]; maxPdfs?: number }
) {
  const scraper = new CbseScraper({ rateLimitMs: 3000 });

  try {
    await db
      .update(scrapeJobs)
      .set({ status: "running", startedAt: new Date() })
      .where(eq(scrapeJobs.id, jobId));

    const processed = await scraper.scrape({
      jobId,
      grades: options.grades,
      maxPdfs: options.maxPdfs,
    });

    await db
      .update(scrapeJobs)
      .set({
        status: "completed",
        completedAt: new Date(),
        itemsProcessed: processed,
      })
      .where(eq(scrapeJobs.id, jobId));
  } catch (err) {
    await db
      .update(scrapeJobs)
      .set({
        status: "failed",
        completedAt: new Date(),
        errorLog: err instanceof Error ? err.message : String(err),
      })
      .where(eq(scrapeJobs.id, jobId));
  }
}
