import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { scrapeJobs } from "@/db/schema/system";
import { eq } from "drizzle-orm";

// GET /api/admin/scrape-jobs/:id — Get a single scrape job
export async function GET(
  _request: NextRequest,
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

  const [job] = await db.select().from(scrapeJobs).where(eq(scrapeJobs.id, jobId)).limit(1);

  if (!job) {
    return NextResponse.json(
      { success: false, error: { code: "NOT_FOUND", message: "Job not found" } },
      { status: 404 }
    );
  }

  return NextResponse.json({ success: true, data: job });
}
