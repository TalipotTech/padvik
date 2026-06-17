/**
 * Class-section splitter for combined-class syllabus PDFs.
 *
 * Why this exists
 * ----------------------------------------------------------------------------
 * CBSE publishes ONE "Secondary" syllabus PDF that covers both Class IX and
 * Class X in a single document (filename pattern: *_Sec_YYYY-YY.pdf), and
 * ONE "Senior Secondary" PDF covering Classes XI + XII (*_SrSec_*.pdf).
 *
 * Before this splitter existed, the scraper would send the combined PDF's
 * text to the AI once and then insert the resulting chapters/topics into
 * BOTH grades' subject rows — so Class IX topics ended up filed under
 * Class 10, mixed with real Class X topics. The student-facing Curriculum
 * page then showed Class IX content when a user clicked a "Class 10" topic.
 *
 * What this does
 * ----------------------------------------------------------------------------
 * Given the raw PDF text and the list of grades the PDF purports to cover,
 * locate per-class section headers ("CLASS IX", "Class X", "Class-XI",
 * "CLASS 10", etc.) and slice the text so each grade's section contains
 * ONLY that class's syllabus. The scraper then invokes the AI once per
 * grade with the correct slice.
 *
 * Returns
 * ----------------------------------------------------------------------------
 * - Map<grade, sectionText> on successful split — caller iterates and
 *   parses each grade independently.
 * - null when the PDF has no detectable per-class headers, or the slices
 *   are suspiciously short (< 500 chars). Caller should fall back to
 *   single-AI-call behaviour but log a warning so the admin knows the
 *   resulting subject rows may be contaminated.
 *
 * Design notes
 * ----------------------------------------------------------------------------
 * - Markers are detected at line starts so inline references like
 *   "(see Class X, page 12)" don't trigger a false split.
 * - Both Roman (IX, X, XI, XII) and Arabic (9, 10, 11, 12) numerals
 *   are accepted — CBSE uses Roman everywhere in practice but the helper
 *   is general enough for state boards that use Arabic.
 * - First line-start occurrence of each grade's marker is used. A PDF
 *   whose TOC references "Class X" before the actual Class X section
 *   still gives us the right ordering because both Class IX and Class X
 *   TOC entries will appear in order before both main sections.
 */

/** Canonical Roman numerals for Indian classes 9–12. */
const ROMAN_BY_GRADE: Record<number, string> = {
  9: "IX",
  10: "X",
  11: "XI",
  12: "XII",
};

/** Per-grade slice. `startPage` is only populated when the caller passes
 *  `pageOffsets` — it's the 1-indexed page in the source PDF where that
 *  grade's section begins. Consumers use it to jump an embedded PDF
 *  viewer to the right page (#page=N).
 *
 *  `startOffset` / `endOffset` are the char positions of this grade's
 *  section inside the ORIGINAL (un-split) PDF text. Downstream consumers
 *  (notably `cbse-content-fill`) use them to bound per-chapter searches
 *  to just this grade's half of the document, so a Class X chapter
 *  called "Networking" can't accidentally match the Class IX
 *  "Networking" header that appears earlier in the same PDF. */
export type GradeSlice = {
  text: string;
  startPage?: number;
  /** Char offset in the full PDF text where this grade's section begins. */
  startOffset: number;
  /** Char offset where this grade's section ends (exclusive). */
  endOffset: number;
};

/**
 * Split combined-class syllabus text into per-grade sections.
 *
 * @param pdfText       Raw text extracted from the PDF.
 * @param grades        Grades the caller expects this PDF to cover (e.g. [9, 10]).
 * @param pageOffsets   Optional. Char offsets where each PDF page begins,
 *                      as returned by `extractTextFromPdfWithPages`. When
 *                      supplied, each slice also gets a `startPage` field
 *                      so UI viewers can jump past the other grade's pages.
 * @returns Map keyed by grade, or `null` when markers couldn't be located
 *          for every requested grade.
 */
export function splitSyllabusByClass(
  pdfText: string,
  grades: number[],
  pageOffsets?: number[]
): Map<number, GradeSlice> | null {
  if (grades.length < 2) return null; // Nothing to split — single-class PDF.

  type Header = { grade: number; offset: number };
  const headers: Header[] = [];

  for (const grade of grades) {
    const roman = ROMAN_BY_GRADE[grade];
    if (!roman) continue;

    // Build alternation patterns for this grade: Roman OR Arabic numeral.
    // Anchor on (start-of-string | newline) so inline references don't match.
    // Tolerate whitespace / hyphen between "CLASS" and the numeral.
    // Require a non-letter boundary after the numeral so "CLASS X" doesn't
    // eat into "CLASS XI".
    const patterns: RegExp[] = [
      new RegExp(`(?:^|\\n)[ \\t]*class[\\s\\-]*${roman}(?![A-Z])`, "gi"),
      new RegExp(`(?:^|\\n)[ \\t]*class[\\s\\-]*${grade}\\b`, "gi"),
    ];

    let firstOffset = -1;
    for (const re of patterns) {
      let m: RegExpExecArray | null;
      while ((m = re.exec(pdfText)) !== null) {
        // If the match consumed a leading newline, shift past it so the
        // offset points at the "C" of "Class", not the newline before.
        const offset = m[0].startsWith("\n") ? m.index + 1 : m.index;
        if (firstOffset === -1 || offset < firstOffset) {
          firstOffset = offset;
        }
      }
    }

    if (firstOffset === -1) {
      // One or more requested grades has no header — abort split; caller
      // will use the full text for every grade and warn.
      return null;
    }
    headers.push({ grade, offset: firstOffset });
  }

  if (headers.length !== grades.length) return null;

  // Sort headers by position and slice between them. The last header's
  // slice runs to end-of-text.
  headers.sort((a, b) => a.offset - b.offset);

  // Guard against two grades resolving to the same offset (e.g. a header
  // line that says "Class IX / Class X" shared between them). That would
  // give one grade a zero-length slice.
  for (let i = 1; i < headers.length; i++) {
    if (headers[i].offset === headers[i - 1].offset) return null;
  }

  // Helper: convert a text offset into a 1-indexed page number using the
  // pageOffsets array (same semantics as parser.ts's offsetToPageNumber).
  // Duplicated here rather than imported to keep the splitter self-contained
  // and free of a dependency on the PDF parser.
  const toPage = (charOffset: number): number | undefined => {
    if (!pageOffsets || pageOffsets.length === 0) return undefined;
    for (let i = pageOffsets.length - 1; i >= 0; i--) {
      if (charOffset >= pageOffsets[i]) return i + 1;
    }
    return 1;
  };

  const result = new Map<number, GradeSlice>();
  for (let i = 0; i < headers.length; i++) {
    const { grade, offset } = headers[i];
    const end = i + 1 < headers.length ? headers[i + 1].offset : pdfText.length;
    const slice = pdfText.slice(offset, end);

    // A real per-class section is hundreds of lines. If the slice is tiny
    // we probably matched a TOC entry with no real body following — bail
    // so the caller uses the un-split fallback instead of producing an
    // empty Class X subject.
    if (slice.trim().length < 500) return null;

    result.set(grade, {
      text: slice,
      startPage: toPage(offset),
      startOffset: offset,
      endOffset: end,
    });
  }

  return result;
}
