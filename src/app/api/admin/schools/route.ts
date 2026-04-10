import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { schools } from "@/db/schema/schools";
import { sql } from "drizzle-orm";

// In-memory progress tracking (shared across requests in same process)
export const importProgress: Record<string, {
  running: boolean;
  source: string;
  startedAt: number;
  message: string;
  inserted: number;
  updated: number;
  errors: number;
  durationMs?: number;
}> = {};

/**
 * POST /api/admin/schools/import — Run school import directly
 * Runs in-process (no Redis needed), with progress tracking via GET polling.
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session || (session.user as { role?: string }).role !== "admin") {
    return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Admin required" } }, { status: 403 });
  }

  let body: { source: string; stateFilter?: string };
  try { body = await request.json(); } catch {
    return NextResponse.json({ success: false, error: { code: "INVALID_JSON", message: "Invalid JSON" } }, { status: 400 });
  }

  const { source, stateFilter } = body;

  if (importProgress[source]?.running) {
    return NextResponse.json({
      success: false,
      error: { code: "ALREADY_RUNNING", message: `Import for ${source} is already running: ${importProgress[source].message}` },
    }, { status: 409 });
  }

  // Initialize progress
  importProgress[source] = {
    running: true, source, startedAt: Date.now(),
    message: "Starting...", inserted: 0, updated: 0, errors: 0,
  };

  // Run in background (non-blocking)
  runImport(source, stateFilter).catch(err => {
    importProgress[source] = {
      ...importProgress[source],
      running: false,
      message: `Failed: ${err instanceof Error ? err.message : "Unknown error"}`,
    };
  });

  return NextResponse.json({
    success: true,
    data: { source, status: "started", message: "Import started. Poll GET /api/admin/schools/import for progress." },
  });
}

async function runImport(source: string, stateFilter?: string) {
  try {
    const { importAllSchools } = await import("@/lib/schools/import-all");

    const results = await importAllSchools({
      sources: [source as "cbse_github" | "sametham" | "cbse_saras" | "icse_scrape" | "udise"],
      stateFilter,
      onProgress: (msg) => {
        if (importProgress[source]) {
          importProgress[source].message = msg;
        }
      },
    });

    const r = results[0];
    importProgress[source] = {
      running: false, source, startedAt: importProgress[source]?.startedAt || Date.now(),
      message: r ? `Done: ${r.inserted} new, ${r.updated} updated` : "Completed (no data)",
      inserted: r?.inserted || 0,
      updated: r?.updated || 0,
      errors: r?.errors?.length || 0,
      durationMs: r?.durationMs,
    };
  } catch (err) {
    importProgress[source] = {
      ...importProgress[source],
      running: false,
      message: `Error: ${err instanceof Error ? err.message : "Unknown"}`,
    };
  }
}

/**
 * GET /api/admin/schools/import — Poll import progress + DB counts
 */
export async function GET() {
  const session = await auth();
  if (!session || (session.user as { role?: string }).role !== "admin") {
    return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Admin required" } }, { status: 403 });
  }

  const [total] = await db.select({ count: sql<number>`count(*)::int` }).from(schools);
  const bySrc = await db.select({ source: schools.source, count: sql<number>`count(*)::int` }).from(schools).groupBy(schools.source);

  return NextResponse.json({
    success: true,
    data: {
      imports: importProgress,
      dbCounts: {
        total: total?.count ?? 0,
        bySource: Object.fromEntries(bySrc.map(s => [s.source, s.count])),
      },
    },
  });
}
