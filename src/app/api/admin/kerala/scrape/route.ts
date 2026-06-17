import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { scrapeJobs } from "@/db/schema/system";
import { eq, and, inArray } from "drizzle-orm";
import { z } from "zod/v4";
import { DEFAULT_ACADEMIC_YEAR, ACADEMIC_YEAR_REGEX } from "@/lib/academic-year";

// ---------------------------------------------------------------------------
// POST /api/admin/kerala/scrape — Trigger Kerala SCERT textbook download + parse
// ---------------------------------------------------------------------------

const scrapeSchema = z.object({
  classStart: z.number().int().min(1).max(12),
  classEnd: z.number().int().min(1).max(12),
  medium: z.enum(["english", "malayalam", "both"]),
  subjectFilter: z.string().optional(),
  aiProvider: z.enum(["anthropic", "gemini", "mistral", "openai", "perplexity", "sarvam", "auto"]).optional(),
  maxBooks: z.number().int().min(1).max(500).optional(),
  downloadOnly: z.boolean().optional(),
  /** Use DIKSHA API to discover additional textbooks beyond the hardcoded catalog */
  useDikshaDiscovery: z.boolean().optional(),
  /** Academic year ("YYYY-YY") to tag inserted rows with. */
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

  const parsed = scrapeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message },
      },
      { status: 400 }
    );
  }

  const { classStart, classEnd, medium, subjectFilter, aiProvider, maxBooks, downloadOnly, useDikshaDiscovery } = parsed.data;
  const academicYear = parsed.data.academicYear ?? DEFAULT_ACADEMIC_YEAR;

  if (classEnd < classStart) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "VALIDATION_ERROR", message: "classEnd must be >= classStart" },
      },
      { status: 400 }
    );
  }

  // Include the academic year in the synthetic sourceUrl so duplicate
  // detection separates "same classes, different year" jobs — 2025-26 and
  // 2026-27 can run concurrently without colliding.
  const sourceUrl = `kerala-scert://textbooks/${classStart}-${classEnd}/${medium}/${academicYear}`;

  // Duplicate prevention
  const existingJobs = await db
    .select({ id: scrapeJobs.id, status: scrapeJobs.status })
    .from(scrapeJobs)
    .where(
      and(
        eq(scrapeJobs.sourceUrl, sourceUrl),
        eq(scrapeJobs.jobType, "kerala_scrape"),
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
          message: `A Kerala SCERT scrape for Classes ${classStart}-${classEnd} (${medium}) is already ${existingJobs[0].status} (Job #${existingJobs[0].id}).`,
        },
      },
      { status: 409 }
    );
  }

  // Create scrape job record
  const [job] = await db
    .insert(scrapeJobs)
    .values({
      jobType: "kerala_scrape",
      sourceUrl,
      status: "queued",
      metadata: {
        boardCode: "KL_SCERT",
        classStart,
        classEnd,
        medium,
        subjectFilter: subjectFilter ?? null,
        aiProvider: aiProvider ?? "auto",
        maxBooks: maxBooks ?? null,
        downloadOnly: downloadOnly ?? false,
        useDikshaDiscovery: useDikshaDiscovery ?? false,
        academicYear,
        triggeredBy: session.user.email ?? session.user.id,
        triggeredAt: new Date().toISOString(),
      },
    })
    .returning();

  // Enqueue to BullMQ
  const { addKeralaScrapeJob } = await import("@/lib/queue");
  const queueJobId = await addKeralaScrapeJob({
    jobId: job.id,
    classStart,
    classEnd,
    medium,
    subjectFilter,
    aiProvider,
    maxBooks,
    downloadOnly,
    useDikshaDiscovery,
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
