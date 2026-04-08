import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { readFile, stat } from "fs/promises";
import { join } from "path";

/**
 * GET /api/admin/local-pdf?path=data/pdfs/CBSE/10/Arabic.pdf
 *
 * Serves locally-stored PDFs and extracted text files from the scraping pipeline.
 * Only allows paths under approved directories to prevent path traversal attacks.
 */

const ALLOWED_PREFIXES = [
  "data/pdfs/",
  "data/ncert-pdfs/",
  "data/kerala-scert/",
  "data/karnataka/",
  "data/tamilnadu/",
  "data/maharashtra/",
  "data/ap-telangana/",
  "data/diksha-raw/",
];

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session || session.user.role !== "admin") {
    return new NextResponse("Unauthorized", { status: 403 });
  }

  const relativePath = request.nextUrl.searchParams.get("path");
  if (!relativePath) {
    return new NextResponse("Missing path parameter", { status: 400 });
  }

  // Security: normalize and validate path
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

    // Determine content type from extension
    const isPdf = normalized.endsWith(".pdf");
    const isTxt = normalized.endsWith(".txt");
    const isJson = normalized.endsWith(".json");

    const contentType = isPdf
      ? "application/pdf"
      : isTxt
        ? "text/plain; charset=utf-8"
        : isJson
          ? "application/json"
          : "application/octet-stream";

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(buffer.length),
        "Content-Disposition": isPdf ? "inline" : "inline",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return new NextResponse("File not found", { status: 404 });
    }
    return new NextResponse(`Error reading file: ${err instanceof Error ? err.message : "Unknown"}`, {
      status: 500,
    });
  }
}
