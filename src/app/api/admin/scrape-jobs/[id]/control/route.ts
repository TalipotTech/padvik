import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { scrapeJobs } from "@/db/schema/system";
import { eq } from "drizzle-orm";
import { z } from "zod/v4";

const controlSchema = z.object({
  action: z.enum(["pause", "resume", "cancel", "restart", "delete"]),
  queueJobId: z.string().optional(),
});

/**
 * POST /api/admin/scrape-jobs/:id/control
 * Control a scrape job: pause, resume, cancel, restart, or delete.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Admin access required" } },
      { status: 403 }
    );
  }

  const { id } = await params;
  const jobId = parseInt(id, 10);
  if (isNaN(jobId)) {
    return NextResponse.json(
      { success: false, error: { code: "INVALID_ID", message: "Invalid job ID" } },
      { status: 400 }
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

  const parsed = controlSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } },
      { status: 400 }
    );
  }

  const { action, queueJobId } = parsed.data;

  try {
    switch (action) {
      case "pause": {
        await db
          .update(scrapeJobs)
          .set({ status: "paused" })
          .where(eq(scrapeJobs.id, jobId));

        const { pauseScrapeQueue } = await import("@/lib/queue");
        await pauseScrapeQueue();
        break;
      }
      case "resume": {
        await db
          .update(scrapeJobs)
          .set({ status: "queued" })
          .where(eq(scrapeJobs.id, jobId));

        const { resumeScrapeQueue } = await import("@/lib/queue");
        await resumeScrapeQueue();
        break;
      }
      case "cancel": {
        await db
          .update(scrapeJobs)
          .set({ status: "cancelled", completedAt: new Date() })
          .where(eq(scrapeJobs.id, jobId));

        if (queueJobId) {
          const { cancelScrapeJob } = await import("@/lib/queue");
          await cancelScrapeJob(queueJobId);
        }
        break;
      }
      case "restart": {
        // Fetch original job to re-use its metadata
        const [originalJob] = await db
          .select()
          .from(scrapeJobs)
          .where(eq(scrapeJobs.id, jobId))
          .limit(1);

        if (!originalJob) {
          return NextResponse.json(
            { success: false, error: { code: "NOT_FOUND", message: "Job not found" } },
            { status: 404 }
          );
        }

        const meta = (originalJob.metadata ?? {}) as Record<string, unknown>;

        // Create a new job record cloning the original settings
        const [newJob] = await db
          .insert(scrapeJobs)
          .values({
            jobType: originalJob.jobType,
            sourceUrl: originalJob.sourceUrl,
            boardId: originalJob.boardId,
            status: "queued",
            metadata: {
              ...meta,
              restartedFrom: jobId,
              triggeredAt: new Date().toISOString(),
            },
          })
          .returning();

        // Enqueue
        const { addScrapeJob } = await import("@/lib/queue");
        const boardCode = (meta.boardCode as string) ?? "CBSE";
        const newQueueJobId = await addScrapeJob({
          jobId: newJob.id,
          boardCode,
          jobType: originalJob.jobType,
          grades: (meta.grades as number[] | undefined) ?? undefined,
          maxPdfs: (meta.maxPdfs as number | undefined) ?? undefined,
          aiProvider: (meta.aiProvider as string | undefined) as "auto" | undefined,
        });

        // Store queueJobId
        await db
          .update(scrapeJobs)
          .set({
            metadata: {
              ...(newJob.metadata as Record<string, unknown>),
              queueJobId: newQueueJobId,
            },
          })
          .where(eq(scrapeJobs.id, newJob.id));

        return NextResponse.json({
          success: true,
          data: { jobId: newJob.id, action, queueJobId: newQueueJobId },
        });
      }
      case "delete": {
        // Remove from queue if possible
        if (queueJobId) {
          try {
            const { removeScrapeJob } = await import("@/lib/queue");
            await removeScrapeJob(queueJobId);
          } catch {
            // Job may already be gone from queue
          }
        }

        // Delete from DB
        await db.delete(scrapeJobs).where(eq(scrapeJobs.id, jobId));
        break;
      }
    }

    return NextResponse.json({ success: true, data: { jobId, action } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: { code: "CONTROL_ERROR", message } },
      { status: 500 }
    );
  }
}
