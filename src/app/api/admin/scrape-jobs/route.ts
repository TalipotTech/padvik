import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { scrapeJobs } from "@/db/schema/system";
import { desc, eq, and, inArray, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { cbseCurriculumPageUrl } from "@/lib/scraper/cbse-scraper";
import { DEFAULT_ACADEMIC_YEAR, ACADEMIC_YEAR_REGEX } from "@/lib/academic-year";

/**
 * Board → job-type → source URL.
 *
 * CBSE syllabus is resolved per academic-year below (CBSE publishes a new
 * curriculum_YYYY.html page every session), so the entry here is just a
 * placeholder that signals "this job type is supported"; the real URL is
 * computed in the POST handler via `cbseCurriculumPageUrl(academicYear)`.
 */
const BOARD_SOURCE_URLS: Record<string, Record<string, string>> = {
  CBSE: {
    syllabus: "https://cbseacademic.nic.in/curriculum_2026.html",
    question_paper: "https://cbseacademic.nic.in/SQP_CLASSX_2025-26.html",
    textbook: "https://ncert.nic.in/textbook.php",
  },
  ICSE: {
    syllabus: "https://www.cisce.org/regulations-syllabi",
  },
  KL_SCERT: {
    syllabus: "https://scert.kerala.gov.in/curriculum",
  },
};

/**
 * CBSE question papers are only available for Class X and XII.
 * Class IX and XI do NOT have official SQPs on cbseacademic.nic.in.
 */
function getCbseQuestionPaperUrl(grades?: number[]): string {
  if (!grades || grades.length === 0) return "https://cbseacademic.nic.in/SQP_CLASSX_2025-26.html";
  const grade = grades[0];
  if (grade === 12 || grade === 11) return "https://cbseacademic.nic.in/SQP_CLASSXII_2025-26.html";
  return "https://cbseacademic.nic.in/SQP_CLASSX_2025-26.html"; // Default to Class X
}

const SUPPORTED_BOARDS = Object.keys(BOARD_SOURCE_URLS);

// ---------------------------------------------------------------------------
// GET /api/admin/scrape-jobs — List scrape jobs
// ---------------------------------------------------------------------------
// Supports optional query-param filtering so the Coverage page can ask
// "is there a queued/running ncert_download or cbse_content_fill job for
// subject 875 right now?" without pulling 50 unrelated rows.
//
//   ?status=queued,running            comma-sep subset of status values
//   &jobType=ncert_download,cbse_content_fill
//   &subjectId=875                    matches metadata->>'subjectId' for
//                                     jobs that stash it (cbse_content_fill,
//                                     ncert_download per-subject, etc.)
//   &limit=5                          default 50, max 200
//
// All filters are AND'd together. Unknown/empty filters are ignored.
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Admin access required" } },
      { status: 403 }
    );
  }

  const params = request.nextUrl.searchParams;

  const statusParam = params.get("status");
  const jobTypeParam = params.get("jobType");
  const subjectIdParam = params.get("subjectId");
  const limitParam = params.get("limit");

  const allowedStatuses = new Set([
    "queued",
    "running",
    "paused",
    "completed",
    "failed",
    "cancelled",
  ]);
  const statuses = statusParam
    ? statusParam.split(",").map((s) => s.trim()).filter((s) => allowedStatuses.has(s))
    : [];
  const jobTypes = jobTypeParam
    ? jobTypeParam.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  const subjectId = subjectIdParam && /^\d+$/.test(subjectIdParam) ? subjectIdParam : null;
  const limit = Math.min(
    Math.max(1, Number(limitParam) || 50),
    200
  );

  const conditions = [];
  if (statuses.length > 0) conditions.push(inArray(scrapeJobs.status, statuses));
  if (jobTypes.length > 0) conditions.push(inArray(scrapeJobs.jobType, jobTypes));
  if (subjectId) {
    // Stored in metadata as a number; Postgres JSONB cast → text compares
    // literally. Works for cbse_content_fill (set by fill-gaps route) and any
    // future per-subject job that follows the same convention.
    conditions.push(sql`${scrapeJobs.metadata}->>'subjectId' = ${subjectId}`);
  }

  const query = db.select().from(scrapeJobs);
  const jobs = await (conditions.length > 0
    ? query.where(and(...conditions))
    : query
  )
    .orderBy(desc(scrapeJobs.createdAt))
    .limit(limit);

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
  aiProvider: z.enum(["anthropic", "gemini", "mistral", "openai", "perplexity", "sarvam", "auto"]).optional(),
  retrySkipped: z.boolean().optional(),
  /**
   * Academic year in "YYYY-YY" form, e.g. "2026-27". Currently only applied
   * by the CBSE syllabus job — it picks the matching curriculum_YYYY.html
   * page and tags inserted rows with this year. Other jobs ignore it (for
   * now). Defaults to the current session's year.
   */
  academicYear: z.string().regex(ACADEMIC_YEAR_REGEX).optional(),
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

  const { boardCode, jobType, grades, maxPdfs, aiProvider, retrySkipped } = parsed.data;
  const academicYear = parsed.data.academicYear ?? DEFAULT_ACADEMIC_YEAR;

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

  // Validate board supports the requested job type
  const boardUrls = BOARD_SOURCE_URLS[boardCode];
  if (!boardUrls[jobType]) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "NOT_IMPLEMENTED",
          message: `${jobType} scraping is not yet supported for ${boardCode}.`,
        },
      },
      { status: 400 }
    );
  }

  // For CBSE question papers, use grade-specific URL
  let sourceUrl = boardUrls[jobType];
  // CBSE publishes a separate curriculum index page per academic year
  // (curriculum_2026.html, curriculum_2027.html, ...). Resolve it now so
  // the scrape_jobs row stores the actual URL that'll be hit — makes
  // duplicate detection below year-aware too (same board+year can't have
  // two concurrent jobs, but 2025-26 and 2026-27 can run side by side).
  if (boardCode === "CBSE" && jobType === "syllabus") {
    try {
      sourceUrl = cbseCurriculumPageUrl(academicYear);
    } catch (err) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "INVALID_ACADEMIC_YEAR",
            message: err instanceof Error ? err.message : String(err),
          },
        },
        { status: 400 }
      );
    }
  }
  if (boardCode === "CBSE" && jobType === "question_paper") {
    // Only Class 10 and 12 have official SQPs
    if (grades && grades.length > 0) {
      const g = grades[0];
      if (g === 9 || g === 11) {
        // Class 9 and 11 don't have SQPs — use the next board exam class
        const altGrade = g === 9 ? 10 : 12;
        return NextResponse.json({
          success: false,
          error: {
            code: "NO_SQP_AVAILABLE",
            message: `CBSE does not publish Sample Question Papers for Class ${g}. Only Class 10 and 12 have SQPs. Try scraping Class ${altGrade} instead, which covers the same syllabus range. You can also try the Question Bank (qbclass${altGrade}.html).`,
          },
        }, { status: 400 });
      }
    }
    sourceUrl = getCbseQuestionPaperUrl(grades);
  }

  // --- Duplicate prevention ---
  // Check if there's already a queued or running job for the same board+jobType
  const existingJobs = await db
    .select({ id: scrapeJobs.id, status: scrapeJobs.status })
    .from(scrapeJobs)
    .where(
      and(
        eq(scrapeJobs.sourceUrl, sourceUrl),
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
        // Stash the resolved academic year so the admin UI, audit trail,
        // and worker-side resume logic all see the same value even if the
        // default shifts in a later release.
        academicYear,
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
    retrySkipped,
    academicYear,
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
