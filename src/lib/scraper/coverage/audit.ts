/**
 * Content coverage audit — shared core.
 *
 * Same classification logic that `scripts/audit-content-coverage.ts` uses,
 * but exposed as a pure async function so the admin API can call it too.
 *
 * Classifies every topic under a (board, grade, subject) filter into exactly
 * one bucket — the FIRST that applies, in this order:
 *
 *   ok            ≥1 content row passes the student filter from
 *                 /api/learn/topic/[id] (isPublished, review_status,
 *                 qualityScore >= 0.5, no refusal text, length>100)
 *   no_row        0 content_items rows exist for this topic
 *   empty_body    all rows have length(body) = 0
 *   refusal_body  all rows match an AI refusal pattern
 *   too_short     all rows length(body) <= 100
 *   low_quality   all rows qualityScore < 0.5
 *   bad_review    all rows review_status in ('needs_review','rejected')
 *   not_published all rows is_published = false
 *   unknown       fell through — rare, investigate manually
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";

export type CoverageBucket =
  | "ok"
  | "no_row"
  | "empty_body"
  | "refusal_body"
  | "too_short"
  | "low_quality"
  | "bad_review"
  | "not_published"
  | "unknown";

export const COVERAGE_BUCKET_ORDER: CoverageBucket[] = [
  "ok",
  "no_row",
  "empty_body",
  "refusal_body",
  "too_short",
  "low_quality",
  "bad_review",
  "not_published",
  "unknown",
];

export const COVERAGE_BUCKET_LABEL: Record<CoverageBucket, string> = {
  ok: "OK",
  no_row: "NO_ROW",
  empty_body: "EMPTY_BODY",
  refusal_body: "REFUSAL",
  too_short: "TOO_SHORT",
  low_quality: "LOW_QUAL",
  bad_review: "BAD_REVIEW",
  not_published: "UNPUB",
  unknown: "UNKNOWN",
};

export interface CoverageFilter {
  /** Board code (exact match). */
  boardCode?: string;
  /** Grade (1-12). */
  grade?: number;
  /**
   * Subject — matches against subjects.name (ILIKE '%value%').
   * Use subjectId for exact matching instead when you have it.
   */
  subjectName?: string;
  /** Exact subject id — preferred when available. */
  subjectId?: number;
  /** Limit to one chapter number within the subject. */
  chapterNumber?: number;
}

export interface CoverageTopicRow {
  topic_id: number;
  topic_title: string;
  topic_sort_order: number;
  chapter_id: number;
  chapter_number: number;
  chapter_title: string;
  subject_id: number;
  subject_name: string;
  subject_code: string;
  standard_id: number;
  grade: number;
  board_id: number;
  board_code: string;
  board_name: string;
  row_count: number;
  passing_count: number;
  empty_body_count: number;
  refusal_count: number;
  too_short_count: number;
  low_quality_count: number;
  bad_review_count: number;
  unpublished_count: number;
  best_quality: string | null; // decimal as text
  best_row_length: number | null;
  latest_updated_at: string | null;
}

export interface ClassifiedTopic {
  topicId: number;
  title: string;
  sortOrder: number;
  bucket: CoverageBucket;
  rowCount: number;
  passingCount: number;
  bestQuality: number | null;
  bestRowLength: number | null;
  latestUpdatedAt: string | null;
}

export interface CoverageChapter {
  chapterId: number;
  chapterNumber: number;
  title: string;
  topics: ClassifiedTopic[];
  bucketCounts: Record<CoverageBucket, number>;
  okCount: number;
  gapCount: number;
}

export interface CoverageSubject {
  boardCode: string;
  boardName: string;
  grade: number;
  subjectId: number;
  subjectName: string;
  subjectCode: string;
  chapters: CoverageChapter[];
  bucketCounts: Record<CoverageBucket, number>;
  totalTopics: number;
  okCount: number;
  gapCount: number;
  coveragePct: number; // 0-100
}

export interface CoverageReport {
  filter: CoverageFilter;
  subjects: CoverageSubject[];
  /** Flat list if caller wants just topics (e.g. --gaps-only). */
  topics: ClassifiedTopic[];
  summary: {
    totalTopics: number;
    ok: number;
    gaps: number;
    coveragePct: number;
    buckets: Record<CoverageBucket, number>;
  };
}

function zeroBuckets(): Record<CoverageBucket, number> {
  return {
    ok: 0,
    no_row: 0,
    empty_body: 0,
    refusal_body: 0,
    too_short: 0,
    low_quality: 0,
    bad_review: 0,
    not_published: 0,
    unknown: 0,
  };
}

function classify(r: CoverageTopicRow): CoverageBucket {
  if (r.row_count === 0) return "no_row";
  if (r.passing_count > 0) return "ok";
  if (r.empty_body_count === r.row_count) return "empty_body";
  if (r.refusal_count === r.row_count) return "refusal_body";
  if (r.too_short_count + r.empty_body_count === r.row_count) return "too_short";
  if (r.low_quality_count === r.row_count) return "low_quality";
  if (r.bad_review_count === r.row_count) return "bad_review";
  if (r.unpublished_count === r.row_count) return "not_published";
  return "unknown";
}

/**
 * Run the coverage audit. Read-only; no writes.
 */
export async function auditCoverage(filter: CoverageFilter): Promise<CoverageReport> {
  const boardF = filter.boardCode ? sql`b.code = ${filter.boardCode}` : sql`1=1`;
  const gradeF = filter.grade ? sql`st.grade = ${filter.grade}` : sql`1=1`;
  const subjectF = filter.subjectId
    ? sql`s.id = ${filter.subjectId}`
    : filter.subjectName
    ? sql`LOWER(s.name) LIKE ${"%" + filter.subjectName.toLowerCase() + "%"}`
    : sql`1=1`;
  const chapterF = filter.chapterNumber
    ? sql`c.chapter_number = ${filter.chapterNumber}`
    : sql`1=1`;

  // Student filter — mirror of /api/learn/topic/[id]/route.ts.
  const passingExpr = sql`
    ci.id IS NOT NULL
    AND ci.is_published = true
    AND ci.review_status NOT IN ('needs_review','rejected')
    AND (ci.quality_score IS NULL OR ci.quality_score::decimal >= 0.5)
    AND ci.body NOT ILIKE '%is not covered in%'
    AND ci.body NOT ILIKE '%not covered in the provided%'
    AND ci.body NOT ILIKE '%does not appear in the%chapter%'
    AND ci.body NOT ILIKE '%cannot find%in the provided%'
    AND ci.body NOT ILIKE '%the provided text does not%'
    AND length(ci.body) > 100
    AND ci.content_type != 'foundation'
  `;

  const refusalExpr = sql`
    ci.body ILIKE '%is not covered in%'
    OR ci.body ILIKE '%not covered in the provided%'
    OR ci.body ILIKE '%does not appear in the%chapter%'
    OR ci.body ILIKE '%cannot find%in the provided%'
    OR ci.body ILIKE '%the provided text does not%'
  `;

  const q = sql`
    SELECT
      t.id                                                AS topic_id,
      t.title                                             AS topic_title,
      COALESCE(t.sort_order, 0)                           AS topic_sort_order,
      c.id                                                AS chapter_id,
      c.chapter_number                                    AS chapter_number,
      c.title                                             AS chapter_title,
      s.id                                                AS subject_id,
      s.name                                              AS subject_name,
      s.code                                              AS subject_code,
      st.id                                               AS standard_id,
      st.grade                                            AS grade,
      b.id                                                AS board_id,
      b.code                                              AS board_code,
      b.name                                              AS board_name,
      count(ci.id)::int                                   AS row_count,
      COALESCE(SUM(CASE WHEN ${passingExpr}                                                                  THEN 1 ELSE 0 END), 0)::int AS passing_count,
      COALESCE(SUM(CASE WHEN ci.id IS NOT NULL AND length(ci.body) = 0                                       THEN 1 ELSE 0 END), 0)::int AS empty_body_count,
      COALESCE(SUM(CASE WHEN ci.id IS NOT NULL AND (${refusalExpr})                                          THEN 1 ELSE 0 END), 0)::int AS refusal_count,
      COALESCE(SUM(CASE WHEN ci.id IS NOT NULL AND length(ci.body) > 0 AND length(ci.body) <= 100            THEN 1 ELSE 0 END), 0)::int AS too_short_count,
      COALESCE(SUM(CASE WHEN ci.id IS NOT NULL AND ci.quality_score IS NOT NULL AND ci.quality_score::decimal < 0.5 THEN 1 ELSE 0 END), 0)::int AS low_quality_count,
      COALESCE(SUM(CASE WHEN ci.id IS NOT NULL AND ci.review_status IN ('needs_review','rejected')           THEN 1 ELSE 0 END), 0)::int AS bad_review_count,
      COALESCE(SUM(CASE WHEN ci.id IS NOT NULL AND ci.is_published = false                                   THEN 1 ELSE 0 END), 0)::int AS unpublished_count,
      MAX(ci.quality_score::text)                         AS best_quality,
      MAX(length(ci.body))                                AS best_row_length,
      MAX(ci.updated_at)::text                            AS latest_updated_at
    FROM topics t
    JOIN chapters  c  ON c.id  = t.chapter_id
    JOIN subjects  s  ON s.id  = c.subject_id
    JOIN standards st ON st.id = s.standard_id
    JOIN boards    b  ON b.id  = st.board_id
    LEFT JOIN content_items ci ON ci.topic_id = t.id AND ci.content_type != 'foundation'
    WHERE ${boardF} AND ${gradeF} AND ${subjectF} AND ${chapterF}
    GROUP BY t.id, t.title, t.sort_order, c.id, c.chapter_number, c.title,
             s.id, s.name, s.code, st.id, st.grade, b.id, b.code, b.name
    ORDER BY b.code, st.grade, s.name, c.chapter_number, t.sort_order, t.id
  `;

  const res = await db.execute(q);
  const rows = (Array.isArray(res)
    ? res
    : (res as { rows?: CoverageTopicRow[] }).rows ?? []) as CoverageTopicRow[];

  // Group: subject → chapter → topic
  const subjectMap = new Map<number, CoverageSubject>();
  const flat: ClassifiedTopic[] = [];
  const overallBuckets = zeroBuckets();

  for (const r of rows) {
    const bucket = classify(r);
    overallBuckets[bucket]++;

    // Bigint columns come back from db.execute(sql`...`) as strings — coerce
    // at the API boundary so the JSON the UI sees matches the declared types.
    const topicId = Number(r.topic_id);
    const chapterId = Number(r.chapter_id);
    const subjectId = Number(r.subject_id);
    const grade = Number(r.grade);

    const classified: ClassifiedTopic = {
      topicId,
      title: r.topic_title,
      sortOrder: Number(r.topic_sort_order ?? 0),
      bucket,
      rowCount: Number(r.row_count),
      passingCount: Number(r.passing_count),
      bestQuality: r.best_quality != null ? Number(r.best_quality) : null,
      bestRowLength: r.best_row_length != null ? Number(r.best_row_length) : null,
      latestUpdatedAt: r.latest_updated_at,
    };
    flat.push(classified);

    let subj = subjectMap.get(subjectId);
    if (!subj) {
      subj = {
        boardCode: r.board_code,
        boardName: r.board_name,
        grade,
        subjectId,
        subjectName: r.subject_name,
        subjectCode: r.subject_code,
        chapters: [],
        bucketCounts: zeroBuckets(),
        totalTopics: 0,
        okCount: 0,
        gapCount: 0,
        coveragePct: 0,
      };
      subjectMap.set(subjectId, subj);
    }

    let chap = subj.chapters.find((ch) => ch.chapterId === chapterId);
    if (!chap) {
      chap = {
        chapterId,
        chapterNumber: Number(r.chapter_number),
        title: r.chapter_title,
        topics: [],
        bucketCounts: zeroBuckets(),
        okCount: 0,
        gapCount: 0,
      };
      subj.chapters.push(chap);
    }

    chap.topics.push(classified);
    chap.bucketCounts[bucket]++;
    subj.bucketCounts[bucket]++;
    subj.totalTopics++;
  }

  // Finalize per-subject / per-chapter counters
  for (const subj of subjectMap.values()) {
    for (const chap of subj.chapters) {
      chap.okCount = chap.bucketCounts.ok;
      chap.gapCount = chap.topics.length - chap.okCount;
    }
    subj.okCount = subj.bucketCounts.ok;
    subj.gapCount = subj.totalTopics - subj.okCount;
    subj.coveragePct =
      subj.totalTopics > 0 ? Math.round((subj.okCount / subj.totalTopics) * 1000) / 10 : 0;
    // Chapters already ordered by SQL, but resort by chapter_number for safety.
    subj.chapters.sort((a, b) => a.chapterNumber - b.chapterNumber);
  }

  const subjects = Array.from(subjectMap.values()).sort((a, b) => {
    if (a.boardCode !== b.boardCode) return a.boardCode.localeCompare(b.boardCode);
    if (a.grade !== b.grade) return a.grade - b.grade;
    return a.subjectName.localeCompare(b.subjectName);
  });

  const totalTopics = flat.length;
  const ok = overallBuckets.ok;
  const gaps = totalTopics - ok;
  const coveragePct = totalTopics > 0 ? Math.round((ok / totalTopics) * 1000) / 10 : 0;

  return {
    filter,
    subjects,
    topics: flat,
    summary: {
      totalTopics,
      ok,
      gaps,
      coveragePct,
      buckets: overallBuckets,
    },
  };
}
