/**
 * Shared academic-year helpers.
 *
 * Indian education sessions run roughly June–May and are conventionally
 * labelled `YYYY-YY` (start-year + two-digit end-year), e.g. "2025-26" or
 * "2026-27". Every row in `standards` carries one; every scraper, API and
 * UI path that creates or filters those rows needs to agree on a default
 * and a validator.
 *
 * Keeping the default here (rather than duplicating `"2026-27"` across 12+
 * files) means the annual rollover is a one-line change — bump this
 * constant when the new NCERT/CBSE syllabus drops and every downstream
 * fallback picks it up.
 */

/**
 * Default academic year applied when a scraper or API caller doesn't
 * specify one. Exported so entry-points and deep fallbacks both agree.
 * Bump this when the current Indian session rolls over.
 */
export const DEFAULT_ACADEMIC_YEAR = "2026-27";

/**
 * Shape check — `YYYY-YY` where the YY is exactly the last 2 digits of
 * (YYYY+1). Strict on purpose: loose checks let nonsense like "2025-01"
 * or "2025-2026" through, which then pollute the standards.academic_year
 * column (UNIQUE key) and fragment the curriculum tree.
 */
export const ACADEMIC_YEAR_REGEX = /^\d{4}-\d{2}$/;

/**
 * Returns true iff `value` is a well-formed `YYYY-YY` string whose end
 * year is the successor of the start year. Used at API boundaries (Zod
 * refine) and in the notification scraper's filename detector.
 */
export function isValidAcademicYear(value: string): boolean {
  if (!ACADEMIC_YEAR_REGEX.test(value)) return false;
  const start = parseInt(value.slice(0, 4), 10);
  const end = parseInt(value.slice(5, 7), 10);
  return end === (start + 1) % 100;
}

/**
 * List of recent + near-future academic years, newest first. Drives
 * the dropdown on /scrape-jobs so admins can pick a session without
 * free-typing. The list is intentionally small — we only need 2–3
 * years of history for reruns; older rows stay searchable via the
 * coverage filters API.
 */
export const SELECTABLE_ACADEMIC_YEARS = ["2026-27", "2025-26", "2024-25"] as const;
export type SelectableAcademicYear = (typeof SELECTABLE_ACADEMIC_YEARS)[number];
