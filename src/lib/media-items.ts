/**
 * Shared types and helpers for creator content media items.
 * Media items are stored in creatorContent.metadata.mediaItems[]
 */

export interface MediaItem {
  type: "video" | "audio" | "image" | "document";
  url: string;
  fileUploadId: number;
  fileName: string;
  fileSize: number;
  mimeType: string;
  order: number;
  extractedText?: string;
  duration?: number;
}

/** Detect media type from MIME string */
export function detectMediaType(mime: string): MediaItem["type"] | null {
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("image/")) return "image";
  if (
    mime === "application/pdf" ||
    mime === "application/msword" ||
    mime.includes("officedocument") ||
    mime.includes("presentationml") ||
    mime.includes("ms-powerpoint")
  ) return "document";
  return null;
}

/** Determine the dominant content type from a list of media items */
export function dominantContentType(items: MediaItem[], hasBody: boolean): string {
  if (items.some(i => i.type === "video")) return "video";
  if (items.some(i => i.type === "audio")) return "audio";
  if (items.some(i => i.type === "image")) return "note"; // images = handwritten/visual notes
  if (items.some(i => i.type === "document")) return "document";
  if (hasBody) return "note";
  return "note";
}

/** Pick the primary media URL (for the mediaUrl column) */
export function primaryMediaUrl(items: MediaItem[]): string | null {
  // Prefer: video > audio > first image > first document
  const video = items.find(i => i.type === "video");
  if (video) return video.url;
  const audio = items.find(i => i.type === "audio");
  if (audio) return audio.url;
  const image = items.find(i => i.type === "image");
  if (image) return image.url;
  const doc = items.find(i => i.type === "document");
  if (doc) return doc.url;
  return null;
}

/** Pick the primary fileUploadId */
export function primaryFileUploadId(items: MediaItem[]): number | null {
  const url = primaryMediaUrl(items);
  if (!url) return null;
  const item = items.find(i => i.url === url);
  return item?.fileUploadId ?? null;
}

/** Synthesize mediaItems from legacy handwritten metadata */
export function synthesizeFromLegacy(metadata: Record<string, unknown>): MediaItem[] {
  const imageUrls = (metadata.imageUrls as string[]) || [];
  const uploadIds = (metadata.imageUploadIds as number[]) || [];

  if (imageUrls.length === 0) return [];

  return imageUrls.map((url, i) => ({
    type: "image" as const,
    url,
    fileUploadId: uploadIds[i] || 0,
    fileName: url.split("/").pop() || `page-${i + 1}`,
    fileSize: 0,
    mimeType: "image/jpeg",
    order: i,
    extractedText: undefined,
  }));
}

/** MIME validation map with size limits */
export const ALLOWED_MIMES: Record<string, { type: MediaItem["type"]; maxMb: number }> = {
  // Video
  "video/mp4": { type: "video", maxMb: 2048 },
  "video/webm": { type: "video", maxMb: 2048 },
  "video/quicktime": { type: "video", maxMb: 2048 },
  "video/ogg": { type: "video", maxMb: 2048 },
  "video/x-matroska": { type: "video", maxMb: 2048 },
  // Audio
  "audio/mpeg": { type: "audio", maxMb: 500 },
  "audio/wav": { type: "audio", maxMb: 500 },
  "audio/mp4": { type: "audio", maxMb: 500 },
  "audio/x-m4a": { type: "audio", maxMb: 500 },
  "audio/ogg": { type: "audio", maxMb: 500 },
  "audio/webm": { type: "audio", maxMb: 500 },
  "audio/aac": { type: "audio", maxMb: 500 },
  "audio/flac": { type: "audio", maxMb: 500 },
  "audio/x-wav": { type: "audio", maxMb: 500 },
  // Images
  "image/jpeg": { type: "image", maxMb: 20 },
  "image/png": { type: "image", maxMb: 20 },
  "image/webp": { type: "image", maxMb: 20 },
  "image/gif": { type: "image", maxMb: 20 },
  "image/svg+xml": { type: "image", maxMb: 20 },
  "image/bmp": { type: "image", maxMb: 20 },
  "image/tiff": { type: "image", maxMb: 20 },
  // Documents
  "application/pdf": { type: "document", maxMb: 50 },
  "application/msword": { type: "document", maxMb: 50 },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { type: "document", maxMb: 50 },
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": { type: "document", maxMb: 50 },
  "application/vnd.ms-powerpoint": { type: "document", maxMb: 50 },
};

/** Validate a file and return its media type, or an error string */
export function validateFile(file: File): { type: MediaItem["type"]; maxMb: number } | string {
  const entry = ALLOWED_MIMES[file.type];
  if (!entry) return `File type ${file.type} is not allowed`;
  if (file.size > entry.maxMb * 1024 * 1024) return `${entry.type} files must be under ${entry.maxMb}MB`;
  return entry;
}
