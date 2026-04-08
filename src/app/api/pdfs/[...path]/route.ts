import { NextRequest, NextResponse } from "next/server";
import { readFile, stat } from "fs/promises";
import { join } from "path";

/**
 * GET /api/pdfs/{...path}
 * Serves PDF files from local storage directories.
 * Supports: data/pdfs/, data/pdf-cache/, data/ncert-pdfs/
 */

const ALLOWED_PREFIXES = [
  "data/pdfs/",
  "data/pdf-cache/",
  "data/ncert-pdfs/",
];

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path: segments } = await params;
  const requestedPath = segments.join("/");

  // Try each allowed prefix to find the file
  let fullPath: string | null = null;
  let normalizedPath: string | null = null;

  for (const prefix of ALLOWED_PREFIXES) {
    const candidate = `${prefix}${requestedPath}`;
    const normalized = candidate.replace(/\\/g, "/").replace(/\.\./g, "");

    if (!normalized.startsWith(prefix)) continue;

    const testPath = join(process.cwd(), normalized);
    try {
      const fileStat = await stat(testPath);
      if (fileStat.isFile()) {
        fullPath = testPath;
        normalizedPath = normalized;
        break;
      }
    } catch {
      // Try next prefix
    }
  }

  if (!fullPath) {
    return new NextResponse("Not found", { status: 404 });
  }

  try {
    const buffer = await readFile(fullPath);

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": "inline",
        "Cache-Control": "public, max-age=604800, immutable",
        "Content-Length": String(buffer.length),
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
