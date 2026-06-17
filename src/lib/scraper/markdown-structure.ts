// ---------------------------------------------------------------------------
// Markdown structure parser — extracts chapter/section hierarchy from the
// AI-generated NCERT textbook notes so `chapters.title` and `topics.title` can
// be populated from real textbook headings instead of "Chapter N" placeholders.
//
// The NCERT extractor prompt guarantees this shape:
//   # <chapter title>
//   ## <section 1 title>
//   <section 1 body…>
//   ## <section 2 title>
//   <section 2 body…>
//   …
//
// We parse the first H1 → chapter title, and every H2 → one topic/section with
// the body lines (including its H2 header) attached until the next H2.
//
// Kept free of DB and Node imports so it can be exercised from tests and from
// both the ncert-downloader parse path and the /api/admin/coverage/backfill-
// titles endpoint without pulling in server-only deps.
// ---------------------------------------------------------------------------

export interface MarkdownSection {
  /** H2 heading text, prettified (all-caps normalized to title case). */
  title: string;
  /** Raw section body, including the H2 header line itself. */
  body: string;
  /** 1-based ordinal within the chapter. */
  sortOrder: number;
}

export interface MarkdownStructure {
  /** H1 heading text if present, prettified. */
  chapterTitle: string | null;
  /** H2-delimited sections. Empty if no H2 found (see fallback below). */
  sections: MarkdownSection[];
  /**
   * Any body text that appeared between the H1 and the first H2. Usually
   * empty for NCERT content, but we preserve it rather than silently dropping
   * content that doesn't fit the expected shape. Callers can decide whether
   * to prepend it to the first section or store it as a chapter intro.
   */
  preSectionBody: string;
}

// ---------------------------------------------------------------------------
// Prettify headings for display
//
// Source material isn't consistent: Ch 1 emits "# Real Numbers" (title case)
// while Ch 2 emits "# POLYNOMIALS" (all caps). Both are the textbook's own
// typesetting, but in our syllabus tree an ALL-CAPS label sits awkwardly next
// to the mixed-case ones. We convert ALL-CAPS strings to Title Case and leave
// anything with existing lowercase letters alone.
//
// "All caps" here means: contains ≥2 letters and none of them are lowercase.
// Digits, spaces, punctuation don't count. This correctly treats:
//   "POLYNOMIALS"            → "Polynomials"
//   "PAIR OF LINEAR EQUATIONS" → "Pair Of Linear Equations"
//   "1.1 Introduction"       → "1.1 Introduction" (unchanged — has 'ntroduction')
//   "EXERCISE 2.1"           → "Exercise 2.1"
// ---------------------------------------------------------------------------
export function prettifyHeading(raw: string): string {
  let trimmed = raw.trim();
  if (!trimmed) return trimmed;

  // Strip a leading "Chapter N:" or "Chapter N." or "Chapter N -" prefix.
  // The AI sometimes echoes the chapter-number label from the textbook into
  // the H1 (seen on Ch 8 "Chapter 8: INTRODUCTION TO TRIGONOMETRY", Ch 12,
  // Ch 14). For our syllabus tree the chapter number is a separate column,
  // so the title shouldn't repeat it. Regex is deliberately narrow — only
  // digit-bearing "Chapter N" prefixes, not e.g. "Chapter Review".
  trimmed = trimmed.replace(/^Chapter\s+\d+\s*[:\-–—.]\s*/i, "").trim();
  if (!trimmed) return trimmed;

  const letters = trimmed.replace(/[^A-Za-z]/g, "");
  if (letters.length < 2) return trimmed;
  if (letters !== letters.toUpperCase()) return trimmed;

  // All-caps → Title Case. Keep short connector words lowercase for a more
  // natural English reading, matching how a human would retype the title.
  const minorWords = new Set([
    "a", "an", "and", "as", "at", "but", "by", "for", "in", "of", "on", "or",
    "per", "the", "to", "via", "with",
  ]);

  const words = trimmed.toLowerCase().split(/(\s+)/);
  let isFirstWord = true;
  return words
    .map((token) => {
      if (/^\s+$/.test(token)) return token;
      const word = token;
      const isLower =
        !isFirstWord &&
        minorWords.has(word.replace(/[^a-z]/g, ""));
      isFirstWord = false;
      if (isLower) return word;
      // Capitalize first letter, leave the rest alone (keeps things like
      // "2.1" or inner hyphens as-is).
      return word.replace(/^([a-z])/, (c) => c.toUpperCase());
    })
    .join("");
}

// ---------------------------------------------------------------------------
// parseMarkdownStructure
//
// Walks the markdown line by line. First H1 (`# …`) becomes chapterTitle.
// Every H2 (`## …`) starts a new section; the body includes the H2 line and
// every subsequent line up to (but not including) the next H2 or end-of-doc.
// Lines before the first H2 (but after H1) are collected as preSectionBody.
//
// Deliberately does NOT recurse into H3 — the NCERT prompt uses H3 for
// exercises and sub-parts that belong to their parent H2, so flattening them
// as topics would create navigational noise.
// ---------------------------------------------------------------------------
export function parseMarkdownStructure(markdown: string): MarkdownStructure {
  const lines = markdown.split(/\r?\n/);

  let chapterTitle: string | null = null;
  const preBuffer: string[] = [];
  const sections: MarkdownSection[] = [];
  let current: MarkdownSection | null = null;
  let sawH1 = false;

  for (const line of lines) {
    const h1Match = /^#\s+(.+?)\s*$/.exec(line);
    const h2Match = /^##\s+(.+?)\s*$/.exec(line);

    if (h1Match && !sawH1) {
      chapterTitle = prettifyHeading(h1Match[1]);
      sawH1 = true;
      continue;
    }

    if (h2Match) {
      // Close out the previous section (if any) by appending nothing — its
      // body is already filled. Start a fresh section.
      current = {
        title: prettifyHeading(h2Match[1]),
        body: line + "\n", // include the `## Heading` line as part of the body
        sortOrder: sections.length + 1,
      };
      sections.push(current);
      continue;
    }

    if (current) {
      current.body += line + "\n";
    } else {
      preBuffer.push(line);
    }
  }

  // Trim trailing whitespace on each section's body so round-tripping doesn't
  // accumulate blank lines.
  for (const s of sections) {
    s.body = s.body.replace(/\s+$/, "") + "\n";
  }

  return {
    chapterTitle,
    sections,
    preSectionBody: preBuffer.join("\n").replace(/^\s+|\s+$/g, ""),
  };
}

// ---------------------------------------------------------------------------
// isPlaceholderChapterTitle / isPlaceholderTopicTitle
//
// These mirror the regexes in src/app/(dashboard)/dashboard/syllabus/
// _components/syllabus-explorer.tsx — duplicated here so server-side code can
// decide whether a row's existing title is still a placeholder that should be
// overwritten, without importing from a React component file.
//
// Keep them in sync if the UI regexes change. (The UI uses them to rewrite
// displayed labels; we use them to decide whether it's safe to write over
// the DB title.)
// ---------------------------------------------------------------------------
export const PLACEHOLDER_CHAPTER_TITLE = /[—-]\s*Chapter\s*\d+\s*$/i;
export const PLACEHOLDER_TOPIC_TITLE = /^Chapter \d+ Content$/i;

export function isPlaceholderChapterTitle(title: string): boolean {
  return PLACEHOLDER_CHAPTER_TITLE.test(title);
}

export function isPlaceholderTopicTitle(title: string): boolean {
  return PLACEHOLDER_TOPIC_TITLE.test(title);
}
