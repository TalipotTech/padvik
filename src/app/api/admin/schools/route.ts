import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

// POST /api/admin/schools/import — Trigger school import
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session || (session.user as { role?: string }).role !== "admin") {
    return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Admin required" } }, { status: 403 });
  }

  let body: { source: string; stateFilter?: string };
  try { body = await request.json(); } catch {
    return NextResponse.json({ success: false, error: { code: "INVALID_JSON", message: "Invalid JSON" } }, { status: 400 });
  }

  // Queue the import job
  try {
    const { addSchoolImportJob } = await import("@/lib/queue/index");
    const jobId = await addSchoolImportJob({ source: body.source, stateFilter: body.stateFilter });
    return NextResponse.json({ success: true, data: { jobId, source: body.source } });
  } catch (err) {
    return NextResponse.json({ success: false, error: { code: "QUEUE_ERROR", message: err instanceof Error ? err.message : "Failed to queue" } }, { status: 500 });
  }
}
