import { NextRequest } from "next/server";
import { stat } from "fs/promises";
import { join } from "path";
import { createReadStream } from "fs";
import { isS3Enabled, getStorageObject } from "@/lib/s3";

/**
 * GET /api/uploads/{...path} — Serve uploaded files.
 * In production (S3 enabled) streams from the object store; in dev streams
 * from the local filesystem. Uses ReadableStream to avoid Next.js RSC header
 * interference.
 */

// Prevent Next.js from caching or adding RSC headers
export const dynamic = "force-dynamic";

const ALLOWED_PREFIXES = ["data/uploads/"];

const MIME_MAP: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
  gif: "image/gif", svg: "image/svg+xml", bmp: "image/bmp", tiff: "image/tiff",
  mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", ogg: "video/ogg",
  mkv: "video/x-matroska",
  mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", aac: "audio/aac",
  flac: "audio/flac", oga: "audio/ogg",
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv", txt: "text/plain", json: "application/json",
};

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path: segments } = await params;
  // Storage key (relative path under data/uploads), sanitized against traversal.
  const key = segments.join("/").replace(/\\/g, "/").replace(/\.\./g, "");
  const ext = key.split(".").pop()?.toLowerCase() || "";

  // Production: stream from the S3-compatible object store (shared by web + worker).
  if (isS3Enabled()) {
    const obj = await getStorageObject(key);
    if (!obj) return new Response("Not found", { status: 404 });
    const contentType =
      obj.contentType && obj.contentType !== "application/octet-stream"
        ? obj.contentType
        : MIME_MAP[ext] || "application/octet-stream";
    return new Response(obj.body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        ...(obj.contentLength ? { "Content-Length": String(obj.contentLength) } : {}),
        "Content-Disposition": "inline",
        "Accept-Ranges": "bytes",
        "Cache-Control": "public, max-age=86400",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  // Dev fallback: local filesystem.
  const relativePath = `data/uploads/${segments.join("/")}`;
  const normalized = relativePath.replace(/\\/g, "/").replace(/\.\./g, "");

  if (!ALLOWED_PREFIXES.some((p) => normalized.startsWith(p))) {
    return new Response("Forbidden", { status: 403 });
  }

  const fullPath = join(process.cwd(), normalized);

  try {
    const fileStat = await stat(fullPath);
    if (!fileStat.isFile()) return new Response("Not found", { status: 404 });

    const contentType = MIME_MAP[ext] || "application/octet-stream";

    // Stream the file using Web ReadableStream from Node.js createReadStream
    const nodeStream = createReadStream(fullPath);
    const webStream = new ReadableStream({
      start(controller) {
        nodeStream.on("data", (chunk: Buffer) => {
          controller.enqueue(new Uint8Array(chunk));
        });
        nodeStream.on("end", () => {
          controller.close();
        });
        nodeStream.on("error", (err) => {
          controller.error(err);
        });
      },
      cancel() {
        nodeStream.destroy();
      },
    });

    return new Response(webStream, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(fileStat.size),
        "Content-Disposition": "inline",
        "Accept-Ranges": "bytes",
        "Cache-Control": "public, max-age=86400",
        // Explicitly strip RSC headers by not using NextResponse
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
