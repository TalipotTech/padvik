/**
 * Curriculum coverage — shared core for the simplified admin content pipeline.
 *
 * Three concerns, one dedup'd implementation used by both CLI scripts and
 * /api/admin/coverage/*:
 *   - audit.ts         → read-only topic-by-topic bucket classification
 *   - fan-out.ts       → clone best chapter content to orphan topics
 *   - auto-publish.ts  → flip high-quality NCERT rows to published/auto_approved
 */
export {
  auditCoverage,
  COVERAGE_BUCKET_ORDER,
  COVERAGE_BUCKET_LABEL,
} from "./audit";
export type {
  CoverageBucket,
  CoverageFilter,
  ClassifiedTopic,
  CoverageChapter,
  CoverageSubject,
  CoverageReport,
} from "./audit";
export { fanOutChapterContent } from "./fan-out";
export type { FanOutResult, FanOutOptions } from "./fan-out";
export { autoPublishHighQualityNcert } from "./auto-publish";
export type { AutoPublishResult, AutoPublishOptions } from "./auto-publish";
