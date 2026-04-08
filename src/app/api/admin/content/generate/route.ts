import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { scrapeJobs } from "@/db/schema/system";
import { eq, and, inArray } from "drizzle-orm";
import { z } from "zod/v4";
import { findContentGaps } from "@/lib/ai/content-generator";

// ---------------------------------------------------------------------------
// POST /api/admin/content/generate — AI content gap filler
//
// Finds topics with insufficient content and generates notes, flashcards,
// and MCQs. Supports dryRun mode for cost estimation before committing.
// ---------------------------------------------------------------------------

const generateSchema = z.object({
  /** Generate study notes (Claude Sonnet) */
  notes: z.boolean().optional().default(true),
  /** Generate flashcards (Claude Haiku — cheap) */
  flashcards: z.boolean().optional().default(true),
  /** Generate MCQs (Claude Sonnet) */
  mcqs: z.boolean().optional().default(true),
  /** MCQs per topic (default: 5) */
  mcqCount: z.number().int().min(1).max(20).optional(),
  /** Flashcards per topic (default: 10) */
  flashcardCount: z.number().int().min(1).max(30).optional(),
  /** Max topics to process (default: 50) */
  batchSize: z.number().int().min(1).max(500).optional(),
  /** Filter by board codes */
  boardCodes: z.array(z.string()).optional(),
  /** Filter by grades */
  grades: z.array(z.number().int().min(1).max(12)).optional(),
  /** Filter by subject codes */
  subjects: z.array(z.string()).optional(),
  /** Language for content (default: 'en') */
  language: z.string().optional(),
  /** If true, only estimate cost — no content is generated */
  dryRun: z.boolean().optional().default(false),
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
    return NextResponse.json(
      { success: false, error: { code: "INVALID_JSON", message: "Invalid JSON body" } },
      { status: 400 }
    );
  }

  const parsed = generateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } },
      { status: 400 }
    );
  }

  const opts = parsed.data;

  // For dry run, return gap analysis + cost estimate immediately (no queue)
  if (opts.dryRun) {
    const gaps = await findContentGaps({
      boardCodes: opts.boardCodes,
      grades: opts.grades,
      subjects: opts.subjects,
      limit: opts.batchSize ?? 50,
    });

    // Calculate estimated cost
    const sonnetInputRate = 3.0 / 1_000_000;
    const sonnetOutputRate = 15.0 / 1_000_000;
    const haikuInputRate = 0.8 / 1_000_000;
    const haikuOutputRate = 4.0 / 1_000_000;

    let estimatedCost = 0;
    const topicCount = gaps.length;

    if (opts.notes) {
      estimatedCost += topicCount * (800 * sonnetInputRate + 2500 * sonnetOutputRate);
    }
    if (opts.flashcards) {
      estimatedCost += topicCount * (600 * haikuInputRate + 1500 * haikuOutputRate);
    }
    if (opts.mcqs) {
      estimatedCost += topicCount * (1000 * sonnetInputRate + 3000 * sonnetOutputRate);
    }

    // Group gaps by board/grade for summary
    const summary: Record<string, { count: number; grades: number[] }> = {};
    for (const gap of gaps) {
      const key = gap.boardCode;
      if (!summary[key]) summary[key] = { count: 0, grades: [] };
      summary[key].count++;
      if (!summary[key].grades.includes(gap.grade)) summary[key].grades.push(gap.grade);
    }

    return NextResponse.json({
      success: true,
      data: {
        dryRun: true,
        topicsWithGaps: topicCount,
        estimatedCostUsd: Math.round(estimatedCost * 10000) / 10000,
        contentToGenerate: {
          notes: opts.notes ? topicCount : 0,
          flashcards: opts.flashcards ? topicCount * (opts.flashcardCount ?? 10) : 0,
          mcqs: opts.mcqs ? topicCount * (opts.mcqCount ?? 5) : 0,
        },
        boardBreakdown: summary,
        topPriorityTopics: gaps.slice(0, 10).map((g) => ({
          topicId: g.topicId,
          topic: g.topicTitle,
          chapter: g.chapterTitle,
          subject: g.subjectName,
          board: g.boardCode,
          grade: g.grade,
          currentContent: g.publishedContentCount,
          currentQuestions: g.questionCount,
          priority: g.priority,
        })),
      },
    });
  }

  // Not dry run — create a job and queue it
  const sourceUrl = `content-gen://${opts.boardCodes?.join(",") ?? "all"}/${opts.grades?.join(",") ?? "all"}`;

  // Duplicate prevention
  const existingJobs = await db
    .select({ id: scrapeJobs.id, status: scrapeJobs.status })
    .from(scrapeJobs)
    .where(
      and(
        eq(scrapeJobs.jobType, "content_generate"),
        inArray(scrapeJobs.status, ["queued", "running"])
      )
    )
    .limit(1);

  if (existingJobs.length > 0) {
    return NextResponse.json({
      success: false,
      error: {
        code: "DUPLICATE_JOB",
        message: `A content generation job is already ${existingJobs[0].status} (Job #${existingJobs[0].id}). Wait for it to finish first.`,
      },
    }, { status: 409 });
  }

  const [job] = await db.insert(scrapeJobs).values({
    jobType: "content_generate",
    sourceUrl,
    status: "queued",
    metadata: {
      ...opts,
      triggeredBy: session.user.email ?? session.user.id,
      triggeredAt: new Date().toISOString(),
    },
  }).returning();

  const { addContentGenerateJob } = await import("@/lib/queue");
  const queueJobId = await addContentGenerateJob({
    jobId: job.id,
    notes: opts.notes,
    flashcards: opts.flashcards,
    mcqs: opts.mcqs,
    mcqCount: opts.mcqCount,
    flashcardCount: opts.flashcardCount,
    boardCodes: opts.boardCodes,
    grades: opts.grades,
    subjects: opts.subjects,
    language: opts.language,
    batchSize: opts.batchSize,
    dryRun: false,
  });

  await db.update(scrapeJobs).set({
    metadata: { ...(job.metadata as Record<string, unknown>), queueJobId },
  }).where(eq(scrapeJobs.id, job.id));

  return NextResponse.json({
    success: true,
    data: {
      ...job,
      queueJobId,
      metadata: { ...(job.metadata as Record<string, unknown>), queueJobId },
    },
  }, { status: 201 });
}
