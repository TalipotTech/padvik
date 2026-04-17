/**
 * Dual-mode storage layer: S3 (production) or local filesystem (development).
 * When AWS credentials are not configured, falls back to local storage seamlessly.
 */

import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl as awsGetSignedUrl } from "@aws-sdk/s3-request-presigner";
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from "fs";
import { join, dirname } from "path";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
export const S3_CONFIG = {
  bucket: process.env.AWS_S3_BUCKET || "padvik-uploads",
  region: process.env.AWS_REGION || "ap-south-1",
} as const;

/** Returns true if AWS credentials are configured for S3 uploads */
export function isS3Enabled(): boolean {
  return !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
}

// Lazy-init S3 client
let _s3Client: S3Client | null = null;
function getS3Client(): S3Client {
  if (!_s3Client) {
    _s3Client = new S3Client({
      region: S3_CONFIG.region,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
      },
    });
  }
  return _s3Client;
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

/**
 * Upload a file to storage (S3 or local filesystem).
 * @param key - Storage key, e.g. "creators/4/1234567890-file.pdf"
 * @param body - File contents as Buffer
 * @param contentType - MIME type, e.g. "application/pdf"
 * @returns The public URL of the uploaded file
 */
export async function uploadToStorage(
  key: string,
  body: Buffer,
  contentType: string
): Promise<string> {
  if (isS3Enabled()) {
    const client = getS3Client();
    await client.send(
      new PutObjectCommand({
        Bucket: S3_CONFIG.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ContentDisposition: "inline",
      })
    );
    return `https://${S3_CONFIG.bucket}.s3.${S3_CONFIG.region}.amazonaws.com/${key}`;
  }

  // Local filesystem fallback
  const localPath = join(process.cwd(), "data", "uploads", key);
  const dir = dirname(localPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(localPath, body);
  return `/api/uploads/${key}`;
}

// ---------------------------------------------------------------------------
// Signed URL (for private/premium content)
// ---------------------------------------------------------------------------

/**
 * Get a time-limited signed URL for a file.
 * @param key - Storage key
 * @param expiresIn - URL lifetime in seconds (default: 3600 = 1 hour)
 */
export async function getSignedUrl(key: string, expiresIn = 3600): Promise<string> {
  if (isS3Enabled()) {
    const client = getS3Client();
    const command = new GetObjectCommand({
      Bucket: S3_CONFIG.bucket,
      Key: key,
    });
    return awsGetSignedUrl(client, command, { expiresIn });
  }

  // Local: just return the public path (no signing needed for dev)
  return `/api/uploads/${key}`;
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

/**
 * Delete a file from storage.
 * @param key - Storage key
 */
export async function deleteFromStorage(key: string): Promise<void> {
  if (isS3Enabled()) {
    const client = getS3Client();
    await client.send(
      new DeleteObjectCommand({
        Bucket: S3_CONFIG.bucket,
        Key: key,
      })
    );
    return;
  }

  // Local filesystem
  const localPath = join(process.cwd(), "data", "uploads", key);
  try {
    unlinkSync(localPath);
  } catch {
    // File doesn't exist, ignore
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert a storage key to a publicly accessible URL.
 * In S3 mode: returns the full S3 URL.
 * In local mode: returns /api/uploads/{key}.
 */
export function storageKeyToUrl(key: string): string {
  if (isS3Enabled()) {
    return `https://${S3_CONFIG.bucket}.s3.${S3_CONFIG.region}.amazonaws.com/${key}`;
  }
  return `/api/uploads/${key}`;
}

/**
 * Generate a storage key for creator content files.
 * Format: creators/{userId}/{timestamp}-{sanitizedFilename}
 */
export function generateStorageKey(userId: number, fileName: string): string {
  const timestamp = Date.now();
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `creators/${userId}/${timestamp}-${safeName}`;
}
