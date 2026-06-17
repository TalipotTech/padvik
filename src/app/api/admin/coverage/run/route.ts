import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { and, eq, inArray } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { scrapeJobs } from "@/db/schema/system";
import { subjects } from "@/db/schema/curriculum";
import {
  fanOutChapterContent,
  autoPublishHighQualityNcert,
  type CoverageFilter,
} from "@/lib/scraper/coverage";

// ---------------------------------------------------------------------------
// POST /api/admin/coverage/run
// ---------------------------------------------------------------------------
// One endpoint, four actions — each is a discrete, idempotent step of the
// simplified ingest pipeline as proven on CBSE Cl 10 Mathematics:
//
//   bootstrap     → enqueue NCERT download+parse job (async, minutes)
//   fanout        → clone best chapter content to orphan topics (inline, seconds)
//   autopublish   → flip high-quality NCERT rows to published (inline, seconds)
//   finalize      → fanout + autopublish in one shot (inline)
//
// Filter is Board/Grade/Subject — same shape the /admin/coverage UI passes.
// ---------------------------------------------------------------------------

const runSchema = z.object({
  action: z.enum(["bootstrap", "fanout", "autopublish", "finalize"]),
  board: z.string().min(1).optional(),
  grade: z.number().int().min(1).max(12).optional(),
  /** Either subjectId (number) or subject name fragment (string). */
  subjectId: z.number().int().optional(),
  subjectName: z.string().optional(),
  /**
   * Academic year ("YYYY-YY") the bootstrap job should target. NCERT PDFs
   * are year-agnostic but the curriculum tree is year-specific, so without
   * this the worker falls back to DEFAULT_ACADEMIC_YEAR and an admin who
   * clicks Bootstrap while pinned to 2025-26 would still write into the
   * default-year standards row. Plumbed through to addNcertDownloadJob
   * below; fanout/autopublish are year-scoped via `filter.academicYear`.
   */
  academicYear: z
    .string()
    .regex(/^\d{4}-\d{2}$/, "academicYear must be YYYY-YY")
    .optional(),
  /** Bootstrap-only knobs */
  maxChapters: z.number().int().min(1).max(5000).optional(),
  dryRun: z.boolean().optional(),
});

export async function POST(request: NextRequest) {
  // Auth check — same dev-bypass pattern as /api/admin/content/fill-gaps so
  // both admin content-ops endpoints behave the same way. In development we
  // accept an unauthenticated request as admin (to match the middleware
  // DEV_BYPASS used in src/middleware.ts), but we still honour a real session
  // if one exists — that way signing in as a non-admin user doesn't silently
  // get promoted. In production the session+role check is strict.
  const session = await auth();
  const isAdmin =
    session?.user?.role === "admin" ||
    (!session && process.env.NODE_ENV === "development");
  if (!isAdmin) {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Admin access required" } },
      { status: 403 }
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "INVALID_JSON", message: "Invalid JSON body" } },
      { status: 400 }
    );
  }
  const parsed = runSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message },
      },
      { status: 400 }
    );
  }
  const {
    action,
    board,
    grade,
    subjectId,
    subjectName,
    academicYear,
    maxChapters,
    dryRun,
  } = parsed.data;

  // Fanout + autopublish identify the target session via `subjectId`
  // (which uniquely maps to one standards row and therefore one academic
  // year), so they don't need `academicYear` plumbed separately.
  // Bootstrap is different — it might be *creating* the target subject —
  // so it uses `academicYear` directly in the addNcertDownloadJob call
  // further down.
  const filter: CoverageFilter = {
    boardCode: board,
    grade,
    subjectId,
    subjectName,
  };

  try {
    if (action === "bootstrap") {
      // Enqueue the existing NCERT download pipeline. Currently NCERT is the
      // only proven bootstrap source for CBSE content — state-board sources
      // will plug in here later via a boardCode switch.
      if (!grade) {
        return NextResponse.json(
          { success: false, error: { code: "VALIDATION_ERROR", message: "grade is required for bootstrap" } },
          { status: 400 }
        );
      }
      if (!subjectName && !subjectId) {
        return NextResponse.json(
          { success: false, error: { code: "VALIDATION_ERROR", message: "subjectName or subjectId is required for bootstrap" } },
          { status: 400 }
        );
      }

      // Resolve subjectId → subjectName if needed (NCERT pipeline matches by name).
      let ncertSubjectName = subjectName;
      if (subjectId && !ncertSubjectName) {
        const rows = await db
          .select({ name: subjects.name })
          .from(subjects)
          .where(eq(subjects.id, subjectId))
          .limit(1);
        ncertSubjectName = rows[0]?.name;
      }

      // Dedup: don't enqueue if an identical bootstrap is already active.
      // `academicYear` is part of the dedup key because a 2025-26 bootstrap
      // and a 2026-27 bootstrap for the same subject are distinct jobs —
      // without it, clicking Bootstrap from the 2026-27 UI while a stale
      // 2025-26 job exists would silently short-circuit and return the
      // wrong jobId.
      const sourceUrl = `coverage://bootstrap/${board ?? "all"}/${grade}/${ncertSubjectName ?? "all"}/${academicYear ?? "default"}`;
      const existing = await db
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
      if (existing.length > 0) {
        return NextResponse.json({
          success: true,
          data: {
            action: "bootstrap",
            status: "already_running",
            jobId: existing[0].id,
            message: `Bootstrap is already ${existing[0].status} (Job #${existing[0].id}).`,
          },
        });
      }

      const [job] = await db
        .insert(scrapeJobs)
        .values({
          jobType: "ncert_download",
          sourceUrl,
          status: "queued",
          metadata: {
            coverage: true,
            board: board ?? null,
            grade,
            subject: ncertSubjectName ?? null,
            // Surface the target session in the scrape_jobs audit row so
            // admins can tell 2025-26 vs 2026-27 runs apart at a glance on
            // /scrape-jobs, and the JobStatusCard's "Triggered / Year" chip
            // below shows the right value.
            academicYear: academicYear ?? null,
            maxChapters: maxChapters ?? null,
            // `session` may be null under the dev-bypass branch above; fall
            // back to a synthetic label so scrape_jobs.metadata is still a
            // well-formed audit trail.
            triggeredBy:
              session?.user?.email ?? session?.user?.id ?? "dev-bypass",
            triggeredAt: new Date().toISOString(),
          },
        })
        .returning();

      const { addNcertDownloadJob } = await import("@/lib/queue");
      const queueJobId = await addNcertDownloadJob({
        jobId: job.id,
        grades: [grade],
        subjects: ncertSubjectName ? [ncertSubjectName] : undefined,
        languages: ["en"],
        maxChapters,
        // Pass the UI's pinned session through to the downloader so the
        // `standards` row it creates/finds is the right one. Without this
        // the downloader falls back to DEFAULT_ACADEMIC_YEAR and an admin
        // who pinned 2025-26 in the Session dropdown would still end up
        // writing rows under 2026-27.
        academicYear,
      });

      await db
        .update(scrapeJobs)
        .set({
          metadata: {
            ...(job.metadata as Record<string, unknown>),
            queueJobId,
          },
        })
        .where(eq(scrapeJobs.id, job.id));

      return NextResponse.json({
        success: true,
        data: {
          action: "bootstrap",
          status: "queued",
          jobId: job.id,
          queueJobId,
          message: `Bootstrap queued — watch progress on /scrape-jobs (Job #${job.id}).`,
        },
      });
    }

    if (action === "fanout") {
      const result = await fanOutChapterContent(filter, { dryRun });
      return NextResponse.json({
        success: true,
        data: { action: "fanout", ...result },
      });
    }

    if (action === "autopublish") {
      const result = await autoPublishHighQualityNcert(filter, { dryRun });
      return NextResponse.json({
        success: true,
        data: { action: "autopublish", ...result },
      });
    }

    if (action === "finalize") {
      const fanOut = await fanOutChapterContent(filter, { dryRun });
      const publish = await autoPublishHighQualityNcert(filter, { dryRun });
      return NextResponse.json({
        success: true,
        data: {
          action: "finalize",
          fanOut,
          publish,
          summary: {
            topicsCloned: fanOut.topicsCloned,
            rowsPublished: publish.updated,
            chaptersSkippedNoSource: fanOut.chaptersSkippedNoSource,
          },
        },
      });
    }

    return NextResponse.json(
      { success: false, error: { code: "UNKNOWN_ACTION", message: `Unknown action ${action}` } },
      { status: 400 }
    );
  } catch (err) {
    console.error("[coverage/run] failed:", err);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "RUN_FAILED",
          message: err instanceof Error ? err.message : "Unknown error",
        },
      },
      { status: 500 }
    );
  }
}
