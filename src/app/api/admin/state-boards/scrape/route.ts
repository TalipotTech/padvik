import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { scrapeJobs } from "@/db/schema/system";
import { eq, and, inArray } from "drizzle-orm";
import { z } from "zod/v4";
import { DEFAULT_ACADEMIC_YEAR, ACADEMIC_YEAR_REGEX } from "@/lib/academic-year";

// ---------------------------------------------------------------------------
// POST /api/admin/state-boards/scrape
// Unified endpoint for Karnataka, Tamil Nadu, Maharashtra, AP, Telangana scrapers
// Also handles NCERT mapping for aligned boards (UP, Bihar, MP, etc.)
// ---------------------------------------------------------------------------

const SUPPORTED_BOARDS = [
  "KA_KSEAB", "TN_DGE", "MH_MSBSHSE", "AP_BSEAP", "TS_BSETS",
] as const;

const NCERT_ALIGNED = [
  "UP_UPMSP", "BR_BSEB", "MP_MPBSE", "RJ_RBSE", "GJ_GSEB",
  "CG_CGBSE", "UK_UBSE", "JH_JAC", "HR_BSEH",
] as const;

const scrapeSchema = z.object({
  boardCode: z.string().min(1),
  /** For scraper boards: grade filter */
  grades: z.array(z.number().int().min(1).max(12)).optional(),
  /** Medium filter — varies by board */
  medium: z.string().optional(),
  subjectFilter: z.string().optional(),
  aiProvider: z.enum(["anthropic", "gemini", "mistral", "openai", "perplexity", "sarvam", "auto"]).optional(),
  maxPdfs: z.number().int().min(1).max(1000).optional(),
  downloadOnly: z.boolean().optional(),
  /** For AP/Telangana — which board to target */
  aptsBoard: z.enum(["AP_BSEAP", "TS_BSETS", "both"]).optional(),
  /**
   * Academic year ("YYYY-YY"). Currently informational — the state-board
   * scrapers don't branch on it yet — but we stamp it on every job's
   * metadata so Job History can surface the session alongside the row,
   * and the sourceUrl uses it so 2025-26 and 2026-27 runs don't collide
   * in the dedup check.
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
  try { body = await request.json(); } catch {
    return NextResponse.json({ success: false, error: { code: "INVALID_JSON", message: "Invalid JSON body" } }, { status: 400 });
  }

  const parsed = scrapeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } }, { status: 400 });
  }

  const { boardCode, grades, medium, subjectFilter, aiProvider, maxPdfs, downloadOnly, aptsBoard } = parsed.data;
  const academicYear = parsed.data.academicYear ?? DEFAULT_ACADEMIC_YEAR;

  // Check if this is an NCERT-aligned board (mapping, not scraping)
  const isNCERTAligned = (NCERT_ALIGNED as readonly string[]).includes(boardCode);
  const isScraper = (SUPPORTED_BOARDS as readonly string[]).includes(boardCode);

  if (!isNCERTAligned && !isScraper) {
    return NextResponse.json({
      success: false,
      error: {
        code: "UNSUPPORTED_BOARD",
        message: `Board '${boardCode}' not supported. Scraper boards: ${SUPPORTED_BOARDS.join(", ")}. NCERT-aligned boards: ${NCERT_ALIGNED.join(", ")}.`,
      },
    }, { status: 400 });
  }

  const jobType = isNCERTAligned ? "ncert_mapping" : "state_board_scrape";
  // Include academicYear in the dedup URL so annual-rollover runs don't
  // collide with last session's still-queued job for the same board.
  const sourceUrl = `state-board://${boardCode}/${grades?.join(",") ?? "all"}/${medium ?? "all"}/${academicYear}`;

  // Duplicate prevention
  const existingJobs = await db
    .select({ id: scrapeJobs.id, status: scrapeJobs.status })
    .from(scrapeJobs)
    .where(and(eq(scrapeJobs.sourceUrl, sourceUrl), eq(scrapeJobs.jobType, jobType), inArray(scrapeJobs.status, ["queued", "running"])))
    .limit(1);

  if (existingJobs.length > 0) {
    return NextResponse.json({
      success: false,
      error: { code: "DUPLICATE_JOB", message: `A ${jobType} for ${boardCode} is already ${existingJobs[0].status} (Job #${existingJobs[0].id}).` },
    }, { status: 409 });
  }

  const [job] = await db.insert(scrapeJobs).values({
    jobType,
    sourceUrl,
    status: "queued",
    metadata: {
      boardCode, grades: grades ?? null, medium: medium ?? null,
      subjectFilter: subjectFilter ?? null, aiProvider: aiProvider ?? "auto",
      maxPdfs: maxPdfs ?? null, downloadOnly: downloadOnly ?? false,
      aptsBoard: aptsBoard ?? null, isNCERTAligned,
      academicYear,
      triggeredBy: session.user.email ?? session.user.id,
      triggeredAt: new Date().toISOString(),
    },
  }).returning();

  // Enqueue
  const { addStateBoardScrapeJob } = await import("@/lib/queue");
  const queueJobId = await addStateBoardScrapeJob({
    jobId: job.id,
    boardCode,
    grades,
    medium,
    subjectFilter,
    aiProvider,
    maxPdfs,
    downloadOnly,
    board: aptsBoard,
    academicYear,
  });

  await db.update(scrapeJobs).set({
    metadata: { ...(job.metadata as Record<string, unknown>), queueJobId },
  }).where(eq(scrapeJobs.id, job.id));

  return NextResponse.json({
    success: true,
    data: {
      ...job, queueJobId,
      metadata: { ...(job.metadata as Record<string, unknown>), queueJobId },
      note: isNCERTAligned
        ? `${boardCode} follows NCERT curriculum. Will create topic_mappings to CBSE content instead of duplicating.`
        : `Will scrape textbook PDFs from ${boardCode} source.`,
    },
  }, { status: 201 });
}
