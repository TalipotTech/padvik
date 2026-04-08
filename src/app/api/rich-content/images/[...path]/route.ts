import { NextRequest, NextResponse } from "next/server";
import { readFile, stat } from "fs/promises";
import { join } from "path";

/**
 * GET /api/rich-content/images/{...path}
 * Serves page images from data/uploads/rich-content/.
 * Same pattern as /api/uploads/[...path] but for rich content images.
 */

const ALLOWED_PREFIX = "data/uploads/rich-content/";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path: segments } = await params;
  const relativePath = `data/uploads/rich-content/${segments.join("/")}`;
  const normalized = relativePath.replace(/\\/g, "/").replace(/\.\./g, "");

  if (!normalized.startsWith(ALLOWED_PREFIX)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const fullPath = join(process.cwd(), normalized);

  try {
    const fileStat = await stat(fullPath);
    if (!fileStat.isFile()) return new NextResponse("Not found", { status: 404 });

    const buffer = await readFile(fullPath);
    const ext = fullPath.split(".").pop()?.toLowerCase();
    const contentType =
      ext === "jpg" || ext === "jpeg" ? "image/jpeg"
      : ext === "png" ? "image/png"
      : ext === "webp" ? "image/webp"
      : ext === "gif" ? "image/gif"
      : "application/octet-stream";

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=604800, immutable",
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
