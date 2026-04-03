/**
 * Local PDF and extracted text storage.
 * Saves PDFs to data/pdfs/{boardCode}/{grade}/ during scraping.
 * Will migrate to S3 in production.
 */
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { readFile } from "fs/promises";
import { join } from "path";

const DATA_DIR = join(process.cwd(), "data", "pdfs");

/**
 * Save a downloaded PDF buffer to local filesystem.
 * @returns The local file path relative to project root.
 */
export function savePdfLocally(
  buffer: Buffer,
  boardCode: string,
  grade: number,
  filename: string
): string {
  const dir = join(DATA_DIR, boardCode, String(grade));
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const sanitized = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const filePath = join(dir, sanitized);
  writeFileSync(filePath, buffer);

  // Return relative path from project root
  return `data/pdfs/${boardCode}/${grade}/${sanitized}`;
}

/**
 * Save extracted text alongside the PDF as a .txt file.
 * @returns The local text file path relative to project root.
 */
export function saveExtractedText(
  text: string,
  boardCode: string,
  grade: number,
  filename: string
): string {
  const dir = join(DATA_DIR, boardCode, String(grade));
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const txtFilename = filename.replace(/\.pdf$/i, ".txt");
  const sanitized = txtFilename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const filePath = join(dir, sanitized);
  writeFileSync(filePath, text, "utf-8");

  return `data/pdfs/${boardCode}/${grade}/${sanitized}`;
}

/**
 * Read extracted text from a stored .txt file.
 * @param relativePath Path relative to project root (e.g., "data/pdfs/CBSE/10/Arabic.txt")
 */
export async function readExtractedText(relativePath: string): Promise<string | null> {
  try {
    const fullPath = join(process.cwd(), relativePath);
    return await readFile(fullPath, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Get the absolute filesystem path for a relative storage path.
 */
export function getAbsolutePath(relativePath: string): string {
  return join(process.cwd(), relativePath);
}
