import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { scrapeJobs } from "@/db/schema/system";
import { eq, and, inArray } from "drizzle-orm";
import { z } from "zod/v4";
import { DEFAULT_ACADEMIC_YEAR, ACADEMIC_YEAR_REGEX } from "@/lib/academic-year";

// ---------------------------------------------------------------------------
// POST /api/admin/ncert/download — Trigger NCERT textbook PDF download + parse
// ---------------------------------------------------------------------------

const downloadSchema = z.object({
  /** Grade filter (1-12). Omit to download all. */
  grades: z.array(z.number().int().min(1).max(12)).optional(),
  /** Subject filter. Matches against name, code, or book title (case-insensitive). */
  subjects: z.array(z.string()).optional(),
  /** Language filter. Default: both English and Hindi. */
  languages: z.array(z.enum(["en", "hi"])).optional(),
  /** AI provider for parsing. Default: auto. */
  aiProvider: z.enum(["anthropic", "gemini", "mistral", "openai", "perplexity", "sarvam", "auto"]).optional(),
  /** Max chapters to download (for testing/cost control). */
  maxChapters: z.number().int().min(1).max(5000).optional(),
  /** If true, only download PDFs — skip AI parsing. */
  downloadOnly: z.boolean().optional(),
  /**
   * Academic year ("YYYY-YY") for the standards rows this job will
   * create. NCERT PDFs don't change between sessions, but the curriculum
   * tree we build around them does — tagging with the current session
   * keeps 2025-26 and 2026-27 as separate standards entries.
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

  const parsed = downloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message },
      },
      { status: 400 }
    );
  }

  const { grades, subjects, languages, aiProvider, maxChapters, downloadOnly } = parsed.data;
  const academicYear = parsed.data.academicYear ?? DEFAULT_ACADEMIC_YEAR;

  // Build a stable source URL for dedup. Include the academic year so a
  // 2026-27 bootstrap and a 2025-26 bootstrap with otherwise-identical
  // params don't collide — they produce separate standards rows and
  // should run concurrently during the annual rollover window.
  const gradesStr = grades?.join(",") ?? "all";
  const subjectsStr = subjects?.join(",") ?? "all";
  const langsStr = languages?.join(",") ?? "en,hi";
  const sourceUrl = `ncert://download/${gradesStr}/${subjectsStr}/${langsStr}/${academicYear}`;

  // Duplicate prevention
  const existingJobs = await db
    .select({ id: scrapeJobs.id, status: scrapeJobs.status })
    .from(scrapeJobs)
    .where(
      and(
        eq(scrapeJobs.sourceUrl, sourceUrl),
        eq(scrapeJobs.jobType, "ncert_download"),
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
          message: `An NCERT download with the same parameters is already ${existingJobs[0].status} (Job #${existingJobs[0].id}).`,
        },
      },
      { status: 409 }
    );
  }

  // Create the scrape job record
  const [job] = await db
    .insert(scrapeJobs)
    .values({
      jobType: "ncert_download",
      sourceUrl,
      status: "queued",
      metadata: {
        grades: grades ?? null,
        subjects: subjects ?? null,
        languages: languages ?? null,
        aiProvider: aiProvider ?? "auto",
        maxChapters: maxChapters ?? null,
        downloadOnly: downloadOnly ?? false,
        academicYear,
        triggeredBy: session.user.email ?? session.user.id,
        triggeredAt: new Date().toISOString(),
      },
    })
    .returning();

  // Enqueue to BullMQ
  const { addNcertDownloadJob } = await import("@/lib/queue");
  const queueJobId = await addNcertDownloadJob({
    jobId: job.id,
    grades,
    subjects,
    languages,
    aiProvider,
    maxChapters,
    downloadOnly,
    academicYear,
  });

  // Store queueJobId in metadata
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
    {
      success: true,
      data: {
        ...job,
        queueJobId,
        metadata: { ...(job.metadata as Record<string, unknown>), queueJobId },
      },
    },
    { status: 201 }
  );
}
