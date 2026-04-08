import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { scrapeJobs } from "@/db/schema/system";
import { eq, and, inArray } from "drizzle-orm";
import { z } from "zod/v4";

// ---------------------------------------------------------------------------
// POST /api/admin/diksha/ingest — Trigger DIKSHA content ingestion
// ---------------------------------------------------------------------------

const ingestSchema = z.object({
  boardCode: z.string().min(1),
  gradeStart: z.number().int().min(1).max(12),
  gradeEnd: z.number().int().min(1).max(12),
  subjectFilter: z.string().optional(),
  medium: z.string().optional(),
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

  const parsed = ingestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message },
      },
      { status: 400 }
    );
  }

  const { boardCode, gradeStart, gradeEnd, subjectFilter, medium } = parsed.data;

  if (gradeEnd < gradeStart) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "VALIDATION_ERROR", message: "gradeEnd must be >= gradeStart" },
      },
      { status: 400 }
    );
  }

  // Duplicate prevention — check for existing queued/running DIKSHA ingest for same board
  const sourceUrl = `diksha://${boardCode}/${gradeStart}-${gradeEnd}`;

  const existingJobs = await db
    .select({ id: scrapeJobs.id, status: scrapeJobs.status })
    .from(scrapeJobs)
    .where(
      and(
        eq(scrapeJobs.sourceUrl, sourceUrl),
        eq(scrapeJobs.jobType, "diksha_ingest"),
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
          message: `A DIKSHA ingest for ${boardCode} Classes ${gradeStart}-${gradeEnd} is already ${existingJobs[0].status} (Job #${existingJobs[0].id}).`,
        },
      },
      { status: 409 }
    );
  }

  // Create the scrape job record
  const [job] = await db
    .insert(scrapeJobs)
    .values({
      jobType: "diksha_ingest",
      sourceUrl,
      status: "queued",
      metadata: {
        boardCode,
        gradeStart,
        gradeEnd,
        subjectFilter: subjectFilter ?? null,
        medium: medium ?? null,
        triggeredBy: session.user.email ?? session.user.id,
        triggeredAt: new Date().toISOString(),
      },
    })
    .returning();

  // Enqueue to BullMQ
  const { addDikshaIngestJob } = await import("@/lib/queue");
  const queueJobId = await addDikshaIngestJob({
    jobId: job.id,
    boardCode,
    gradeStart,
    gradeEnd,
    subjectFilter,
    medium,
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
