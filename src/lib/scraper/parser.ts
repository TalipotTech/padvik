/**
 * PDF and HTML parsing utilities.
 */

// pdf-parse v1 exports a single default function
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require("pdf-parse");

/**
 * Extract text content from a PDF buffer.
 */
export async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  const result = await pdfParse(buffer);
  return result.text as string;
}

/**
 * Extract all href links from an HTML page that match a pattern.
 */
export function extractLinks(html: string, pattern: RegExp): string[] {
  const matches: string[] = [];
  const regex = /href=["']([^"']+)["']/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    if (pattern.test(match[1])) {
      matches.push(match[1]);
    }
  }
  return [...new Set(matches)];
}

/**
 * Resolve a relative URL against a base URL.
 */
export function resolveUrl(base: string, relative: string): string {
  try {
    return new URL(relative, base).href;
  } catch {
    return relative;
  }
}
