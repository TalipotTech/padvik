import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { importProgress } from "../route";

export const maxDuration = 300;

/**
 * POST /api/admin/schools/upload-udise — Upload UDISE CSV and trigger import
 * Accepts multipart form with "file" (CSV) and optional "stateFilter"
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session || (session.user as { role?: string }).role !== "admin") {
    return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Admin required" } }, { status: 403 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const stateFilter = formData.get("stateFilter") as string | null;

    if (!file) {
      return NextResponse.json({ success: false, error: { code: "MISSING_FILE", message: "CSV file required" } }, { status: 400 });
    }

    // Validate file type
    if (!file.name.endsWith(".csv") && !file.type.includes("csv") && !file.type.includes("text")) {
      return NextResponse.json({ success: false, error: { code: "INVALID_TYPE", message: "Only CSV files allowed" } }, { status: 400 });
    }

    // Save file locally
    const dataDir = join(process.cwd(), "data");
    if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
    const csvPath = join(dataDir, `udise-upload-${Date.now()}.csv`);
    const buffer = Buffer.from(await file.arrayBuffer());
    writeFileSync(csvPath, buffer);

    const sizeMb = (buffer.length / 1024 / 1024).toFixed(1);
    console.log(`[udise-upload] Saved ${sizeMb}MB CSV to ${csvPath}`);

    // Check if already running
    if (importProgress["udise"]?.running) {
      return NextResponse.json({
        success: false,
        error: { code: "ALREADY_RUNNING", message: "UDISE import is already in progress" },
      }, { status: 409 });
    }

    // Initialize progress
    importProgress["udise"] = {
      running: true, source: "udise", startedAt: Date.now(),
      message: `Uploaded ${sizeMb}MB CSV. Starting import...`, inserted: 0, updated: 0, errors: 0,
    };

    // Run import in background
    runUdiseImport(csvPath, stateFilter || undefined).catch(err => {
      importProgress["udise"] = {
        ...importProgress["udise"],
        running: false,
        message: `Error: ${err instanceof Error ? err.message : "Unknown"}`,
      };
    });

    return NextResponse.json({
      success: true,
      data: { message: `UDISE CSV uploaded (${sizeMb}MB). Import started.`, csvPath },
    });
  } catch (err) {
    return NextResponse.json({
      success: false,
      error: { code: "UPLOAD_ERROR", message: err instanceof Error ? err.message : "Upload failed" },
    }, { status: 500 });
  }
}

async function runUdiseImport(csvPath: string, stateFilter?: string) {
  try {
    const { importFromUdiseDataset } = await import("@/lib/schools/sources/udise-data");
    const result = await importFromUdiseDataset(csvPath, stateFilter, (msg) => {
      if (importProgress["udise"]) {
        importProgress["udise"].message = msg;
      }
    });

    importProgress["udise"] = {
      running: false, source: "udise", startedAt: importProgress["udise"]?.startedAt || Date.now(),
      message: `Done: ${result.inserted} new, ${result.updated} updated`,
      inserted: result.inserted, updated: result.updated, errors: result.errors.length,
      durationMs: result.durationMs,
    };
  } catch (err) {
    importProgress["udise"] = {
      ...importProgress["udise"],
      running: false,
      message: `Error: ${err instanceof Error ? err.message : "Unknown"}`,
    };
  }
}
