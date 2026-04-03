import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { scrapeJobs } from "@/db/schema/system";
import { desc, eq, and, inArray } from "drizzle-orm";
import { z } from "zod/v4";

/** Board code to source URL mapping */
const BOARD_SOURCE_URLS: Record<string, string> = {
  CBSE: "https://cbseacademic.nic.in/curriculum_2026.html",
  ICSE: "https://www.cisce.org/regulations-syllabi",
  KL_SCERT: "https://scert.kerala.gov.in/curriculum",
};

const SUPPORTED_BOARDS = Object.keys(BOARD_SOURCE_URLS);

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
// POST /api/admin/scrape-jobs — Trigger a new scrape job via queue
// ---------------------------------------------------------------------------
const createJobSchema = z.object({
  boardCode: z.string().min(1),
  jobType: z.enum(["syllabus", "question_paper", "textbook"]),
  grades: z.array(z.number().int().min(1).max(12)).optional(),
  maxPdfs: z.number().int().min(1).max(500).optional(),
  aiProvider: z.enum(["anthropic", "gemini", "mistral", "openai", "perplexity", "auto"]).optional(),
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

  const { boardCode, jobType, grades, maxPdfs, aiProvider } = parsed.data;

  // Validate board code
  if (!SUPPORTED_BOARDS.includes(boardCode)) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "NOT_IMPLEMENTED",
          message: `Scraper for ${boardCode} not supported. Supported: ${SUPPORTED_BOARDS.join(", ")}`,
        },
      },
      { status: 400 }
    );
  }

  // --- Duplicate prevention ---
  // Check if there's already a queued or running job for the same board+jobType
  const existingJobs = await db
    .select({ id: scrapeJobs.id, status: scrapeJobs.status })
    .from(scrapeJobs)
    .where(
      and(
        eq(scrapeJobs.sourceUrl, BOARD_SOURCE_URLS[boardCode]),
        eq(scrapeJobs.jobType, jobType),
        inArray(scrapeJobs.status, ["queued", "running"])
      )
    )
    .limit(1);

  if (existingJobs.length > 0) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "DUPLICATE_JOB",
          message: `A ${jobType} scrape for ${boardCode} is already ${existingJobs[0].status} (Job #${existingJobs[0].id}). Wait for it to finish or cancel it first.`,
        },
      },
      { status: 409 }
    );
  }

  const sourceUrl = BOARD_SOURCE_URLS[boardCode];

  // Create the job record with rich metadata
  const [job] = await db
    .insert(scrapeJobs)
    .values({
      jobType,
      sourceUrl,
      boardId: null, // Resolved by scraper
      status: "queued",
      metadata: {
        boardCode,
        aiProvider: aiProvider ?? "auto",
        grades: grades ?? null,
        maxPdfs: maxPdfs ?? null,
        triggeredBy: session.user.email ?? session.user.id,
        triggeredAt: new Date().toISOString(),
      },
    })
    .returning();

  // Enqueue to BullMQ (dynamic import so GET handler works without Redis)
  const { addScrapeJob } = await import("@/lib/queue");
  const queueJobId = await addScrapeJob({
    jobId: job.id,
    boardCode,
    jobType,
    grades,
    maxPdfs,
    aiProvider,
  });

  // Store queueJobId in metadata for later reference
  await db
    .update(scrapeJobs)
    .set({
      metadata: {
        ...(job.metadata as Record<string, unknown>),
        queueJobId,
      },
    })
    .where(eq(scrapeJobs.id, job.id));

  return NextResponse.json(
    { success: true, data: { ...job, queueJobId, metadata: { ...(job.metadata as Record<string, unknown>), queueJobId } } },
    { status: 201 }
  );
}
