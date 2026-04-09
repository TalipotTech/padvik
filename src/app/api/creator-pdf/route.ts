import { NextRequest, NextResponse } from "next/server";
import { readFile, stat } from "fs/promises";
import { join } from "path";

/**
 * GET /api/creator-pdf?path=data/uploads/creators/4/file.pdf
 *
 * Serves PDFs from creator uploads — same pattern as /api/admin/local-pdf
 * which works correctly for inline PDF rendering.
 */

const ALLOWED_PREFIXES = [
  "data/uploads/creators/",
  "data/uploads/notes/",
];

export async function GET(request: NextRequest) {
  const relativePath = request.nextUrl.searchParams.get("path");
  if (!relativePath) {
    return new NextResponse("Missing path parameter", { status: 400 });
  }

  const normalized = relativePath.replace(/\\/g, "/").replace(/\.\./g, "");

  if (!ALLOWED_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return new NextResponse("Path not allowed", { status: 403 });
  }

  const fullPath = join(process.cwd(), normalized);

  try {
    const fileStat = await stat(fullPath);
    if (!fileStat.isFile()) {
      return new NextResponse("Not a file", { status: 404 });
    }

    const buffer = await readFile(fullPath);

    const isPdf = normalized.endsWith(".pdf");
    const contentType = isPdf ? "application/pdf" : "application/octet-stream";

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(buffer.length),
        "Content-Disposition": "inline",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return new NextResponse("File not found", { status: 404 });
    }
    return new NextResponse(`Error: ${err instanceof Error ? err.message : "Unknown"}`, { status: 500 });
  }
}
