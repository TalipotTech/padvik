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
 * Extract text + per-page character offsets from a PDF.
 *
 * Motivation: combined-class CBSE PDFs (`*_Sec_*.pdf`, `*_SrSec_*.pdf`) pack
 * two grades into one document. When we split the text by "Class X" marker
 * we know the byte-offset of that header but the downstream viewer cares
 * about page numbers so it can open `#page=N`. This helper returns the
 * offset-of-page[i] array so callers can convert any text offset into
 * a page number (`offsetToPageNumber` below).
 *
 * Implementation note: pdf-parse's default pagerender joins per-page text
 * with "\n\n". We override pagerender to mirror the default's Y-coordinate
 * logic (so result.text matches byte-for-byte) AND record each page's
 * emitted length. Offsets are then derived by cumulative sum, accounting
 * for the 2-char "\n\n" separator pdf-parse inserts between pages.
 */
export async function extractTextFromPdfWithPages(
  buffer: Buffer
): Promise<{ text: string; pageOffsets: number[]; numPages: number }> {
  const pageLengths: number[] = [];

  type TextItem = { str: string; transform?: number[] };
  type PageData = {
    getTextContent: (opts?: {
      normalizeWhitespace: boolean;
      disableCombineTextItems: boolean;
    }) => Promise<{ items: TextItem[] }>;
  };

  const result = await pdfParse(buffer, {
    // Mirror pdf-parse's default render function byte-for-byte — its source
    // is in node_modules/pdf-parse/lib/pdf-parse.js. If pdf-parse ever
    // changes that logic, update here to stay in sync.
    pagerender: async (pageData: PageData): Promise<string> => {
      const textContent = await pageData.getTextContent({
        normalizeWhitespace: false,
        disableCombineTextItems: false,
      });
      let lastY: number | undefined;
      let text = "";
      for (const item of textContent.items) {
        const itemY = item.transform?.[5];
        if (lastY === itemY || lastY === undefined) {
          text += item.str;
        } else {
          text += "\n" + item.str;
        }
        lastY = itemY;
      }
      pageLengths.push(text.length);
      return text;
    },
  });

  // pdf-parse joins pages with "\n\n" (2 chars) — see its source.
  const JOIN_SEP_LEN = 2;
  const pageOffsets: number[] = [];
  let off = 0;
  for (const len of pageLengths) {
    pageOffsets.push(off);
    off += len + JOIN_SEP_LEN;
  }

  return {
    text: result.text as string,
    pageOffsets,
    numPages: pageLengths.length,
  };
}

/**
 * Given the `pageOffsets` array from `extractTextFromPdfWithPages`, return
 * the 1-indexed page number that contains `charOffset`.
 *
 * Returns 1 for any offset before page 0 (defensive — shouldn't happen
 * with valid input). Returns `pageOffsets.length` for any offset past the
 * last page boundary.
 */
export function offsetToPageNumber(
  pageOffsets: number[],
  charOffset: number
): number {
  if (pageOffsets.length === 0) return 1;
  // Walk backwards — the page that contains `charOffset` is the largest i
  // where pageOffsets[i] <= charOffset.
  for (let i = pageOffsets.length - 1; i >= 0; i--) {
    if (charOffset >= pageOffsets[i]) return i + 1;
  }
  return 1;
}

/**
 * Locate the 1-indexed PDF page where a specific chapter begins.
 *
 * Motivation
 * ----------------------------------------------------------------------------
 * Combined-class CBSE PDFs hold every chapter for both grades (IX+X or
 * XI+XII). The class-splitter already narrows us to "Class X begins on
 * page 4", but every topic under every Class X chapter still points at
 * the same page 4 — students have to scroll to find their chapter. This
 * helper pushes the precision one level deeper: given the full PDF text,
 * the bounds of the relevant grade section, and a chapter's number/title,
 * it returns the page where THAT chapter's header appears.
 *
 * Strategy (tried in order; first win wins)
 * ----------------------------------------------------------------------------
 *  1. Explicit numbered markers at line-start — `Chapter N`, `Unit N`,
 *     `N.` (dotted numeral). Handles the ~90% case of CBSE PDFs whose
 *     chapter openers look like "Unit 2\nHTML & Web Design".
 *  2. Fuzzy title match — normalize both the search title and the PDF
 *     text (lowercase, strip punctuation, collapse whitespace) and find
 *     the first occurrence. Covers chapters like "Internet" that don't
 *     get a "Chapter" prefix in the source PDF.
 *  3. Return `undefined` if nothing fits — caller falls back to the
 *     grade-section start page.
 *
 * Search is always confined to `[startOffset, endOffset)` in the full
 * PDF text so a Class X chapter doesn't accidentally match the Class IX
 * chapter of the same number.
 */
export function findChapterPage(params: {
  fullText: string;
  startOffset: number;
  endOffset: number;
  chapterNumber: number;
  chapterTitle: string;
  pageOffsets: number[];
}): number | undefined {
  const { fullText, startOffset, endOffset, chapterNumber, chapterTitle, pageOffsets } = params;

  if (!pageOffsets || pageOffsets.length === 0) return undefined;
  if (startOffset >= endOffset) return undefined;

  const region = fullText.slice(startOffset, endOffset);
  const n = chapterNumber;

  // Escape regex metacharacters in the number (defensive — chapterNumber
  // is numeric so this is cheap).
  const nEsc = String(n).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // 1. Try explicit chapter/unit/number markers at line-start.
  //    Ordered by specificity — "Chapter 2" beats "2." because the dotted
  //    numeral form also matches "1.2 Something" which isn't a chapter
  //    header. But we still try "N." last since some CBSE PDFs use it.
  const markerPatterns: RegExp[] = [
    new RegExp(`(?:^|\\n)[ \\t]*chapter[\\s\\-]+${nEsc}\\b`, "i"),
    new RegExp(`(?:^|\\n)[ \\t]*unit[\\s\\-]+${nEsc}\\b`, "i"),
    // "N." at line start, followed by whitespace then a capital letter
    // (a chapter-like title, not "1.2" section numbering).
    new RegExp(`(?:^|\\n)[ \\t]*${nEsc}\\.\\s+[A-Z]`, ""),
  ];

  for (const re of markerPatterns) {
    const m = re.exec(region);
    if (m) {
      const offset = startOffset + (m[0].startsWith("\n") ? m.index + 1 : m.index);
      return offsetToPageNumber(pageOffsets, offset);
    }
  }

  // 2. Fuzzy title match. Build a normalized version of both the title
  //    and the region text, and find the first hit.
  const normalize = (s: string): string =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const normTitle = normalize(chapterTitle);
  if (normTitle.length < 3) return undefined;

  // Build a char-to-originalOffset map as we normalize so we can translate
  // the normalized match position back to a real PDF-text offset.
  const offsetMap: number[] = [];
  let normRegion = "";
  let lastSpace = true;
  for (let i = 0; i < region.length; i++) {
    const ch = region[i];
    const lower = ch.toLowerCase();
    const isAlnum = (lower >= "a" && lower <= "z") || (lower >= "0" && lower <= "9");
    if (isAlnum) {
      normRegion += lower;
      offsetMap.push(i);
      lastSpace = false;
    } else if (!lastSpace) {
      normRegion += " ";
      offsetMap.push(i);
      lastSpace = true;
    }
  }
  normRegion = normRegion.trim();
  // offsetMap was built before trim — it's correct as long as we don't
  // rely on trailing-space positions, which indexOf never returns.

  const hit = normRegion.indexOf(normTitle);
  if (hit >= 0 && hit < offsetMap.length) {
    const realOffset = startOffset + offsetMap[hit];
    return offsetToPageNumber(pageOffsets, realOffset);
  }

  return undefined;
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
