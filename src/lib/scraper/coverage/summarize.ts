/**
 * Lightweight per-subject coverage summary.
 *
 * Feeds the Coverage page's Summary grid without loading the per-topic tree.
 * One SQL query per request — aggregates everything the grid needs, including
 * the recommended next action (done / publish_only / fanout_only /
 * bootstrap_needed) so admins can see at a glance what costs tokens vs. what's
 * free (just flip is_published or clone a sibling chapter).
 *
 * Classification mirrors `scripts/tmp-legacy-inventory.ts` — validated against
 * 366 subjects on 2026-04-18. The logic runs in JS, not SQL, so it's easy to
 * tweak the thresholds without re-deploying a migration.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";

export type CoverageRecommendedAction =
  | "done"
  | "publish_only"
  | "fanout_only"
  | "bootstrap_needed"
  | "inspect";

export const RECOMMENDED_ACTION_LABEL: Record<CoverageRecommendedAction, string> = {
  done: "Done",
  publish_only: "Publish only (no tokens)",
  fanout_only: "Fan-out only (no tokens)",
  bootstrap_needed: "Bootstrap required (tokens)",
  inspect: "Inspect manually",
};

export interface SummaryFilter {
  /** Board code (exact). Omit to include every board. */
  boardCode?: string;
  /** Grade 1–12. Omit to include every grade. */
  grade?: number;
  /** Name fragment (ILIKE). Omit to include every subject. */
  subjectName?: string;
}

export interface SummarySubjectRow {
  boardCode: string;
  boardName: string;
  grade: number;
  subjectId: number;
  subjectName: string;
  subjectCode: string;

  totalTopics: number;
  /** Topics with at least one content_items row (any quality, any state). */
  topicsWithAnyContent: number;
  /** Topics that meet the student-facing filter (matches /api/learn/topic/[id]). */
  okTopics: number;
  coveragePct: number;

  chapters: number;
  /** Chapters that have at least one row meeting the fan-out source bar. */
  chaptersWithGoodSrc: number;

  rowsTotal: number;
  rowsPublished: number;
  /** Rows q>=0.7, !published, review_status NOT rejected/auto_approved. Free to flip. */
  rowsHiQUnpub: number;

  recommendedAction: CoverageRecommendedAction;
}

export interface SummaryReport {
  filter: SummaryFilter;
  subjects: SummarySubjectRow[];
  totals: {
    subjects: number;
    done: number;
    publishOnly: number;
    fanoutOnly: number;
    bootstrapNeeded: number;
    inspect: number;
    /** Hi-q unpublished rows contained in subjects classified as publish_only. */
    rowsHiQUnpub: number;
    /** Reusable parsed chapters contained in subjects classified as fanout_only. */
    chaptersWithGoodSrc: number;
    /** Hi-q unpublished rows across every subject in scope — free if flipped. */
    rowsHiQUnpubTotal: number;
  };
}

interface Row {
  board_code: string;
  board_name: string;
  grade: number;
  subject_id: number;
  subject_name: string;
  subject_code: string;
  total_topics: number;
  topics_with_any_content: number;
  ok_topics: number;
  chapters: number;
  chapters_with_good_src: number;
  rows_total: number;
  rows_published: number;
  rows_hi_q_unpub: number;
}

function classify(r: SummarySubjectRow): CoverageRecommendedAction {
  // Matches the proven rules from tmp-legacy-inventory.ts.
  if (r.totalTopics === 0) return "inspect"; // no topics — seed syllabus first
  if (r.okTopics === r.totalTopics && r.rowsHiQUnpub === 0) return "done";
  if (r.rowsHiQUnpub > 0 && r.topicsWithAnyContent === r.totalTopics) return "publish_only";
  if (r.chaptersWithGoodSrc > 0 && r.topicsWithAnyContent < r.totalTopics) return "fanout_only";
  if (r.chaptersWithGoodSrc < r.chapters) return "bootstrap_needed";
  return "inspect";
}

export async function summarizeCoverage(filter: SummaryFilter = {}): Promise<SummaryReport> {
  const boardF = filter.boardCode ? sql`b.code = ${filter.boardCode}` : sql`1=1`;
  const gradeF = filter.grade ? sql`st.grade = ${filter.grade}` : sql`1=1`;
  const subjectF = filter.subjectName
    ? sql`LOWER(s.name) LIKE ${"%" + filter.subjectName.toLowerCase() + "%"}`
    : sql`1=1`;

  // Student-facing passing filter — mirror of audit.ts and /api/learn/topic/[id].
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

  // Fan-out source bar — mirror of fan-out.ts. Strictly >= passing (length>200).
  const fanOutSrcExpr = sql`
    ci2.is_published = true
    AND ci2.review_status NOT IN ('needs_review','rejected')
    AND (ci2.quality_score IS NULL OR ci2.quality_score::decimal >= 0.5)
    AND ci2.body NOT ILIKE '%is not covered in%'
    AND ci2.body NOT ILIKE '%not covered in the provided%'
    AND ci2.body NOT ILIKE '%does not appear in the%chapter%'
    AND ci2.body NOT ILIKE '%cannot find%in the provided%'
    AND ci2.body NOT ILIKE '%the provided text does not%'
    AND length(ci2.body) > 200
    AND ci2.content_type != 'foundation'
  `;

  const q = sql`
    SELECT
      b.code                                              AS board_code,
      b.name                                              AS board_name,
      st.grade                                            AS grade,
      s.id                                                AS subject_id,
      s.name                                              AS subject_name,
      s.code                                              AS subject_code,
      COUNT(DISTINCT t.id)::int                           AS total_topics,
      COUNT(DISTINCT t.id) FILTER (
        WHERE EXISTS (
          SELECT 1 FROM content_items ci
          WHERE ci.topic_id = t.id AND ci.content_type != 'foundation'
        )
      )::int                                              AS topics_with_any_content,
      COUNT(DISTINCT t.id) FILTER (
        WHERE EXISTS (
          SELECT 1 FROM content_items ci
          WHERE ci.topic_id = t.id AND ${passingExpr}
        )
      )::int                                              AS ok_topics,
      COUNT(DISTINCT c.id)::int                           AS chapters,
      COUNT(DISTINCT c.id) FILTER (
        WHERE EXISTS (
          SELECT 1 FROM content_items ci2
          JOIN topics t2 ON t2.id = ci2.topic_id
          WHERE t2.chapter_id = c.id AND ${fanOutSrcExpr}
        )
      )::int                                              AS chapters_with_good_src,
      COALESCE(SUM(CASE WHEN ci.id IS NOT NULL AND ci.content_type != 'foundation' THEN 1 ELSE 0 END), 0)::int AS rows_total,
      COALESCE(SUM(CASE WHEN ci.is_published AND ci.content_type != 'foundation' THEN 1 ELSE 0 END), 0)::int AS rows_published,
      COALESCE(SUM(CASE WHEN ci.quality_score::decimal >= 0.7
                          AND NOT ci.is_published
                          AND ci.review_status NOT IN ('rejected','auto_approved')
                          AND ci.content_type != 'foundation'
                         THEN 1 ELSE 0 END), 0)::int     AS rows_hi_q_unpub
    FROM boards b
    JOIN standards st ON st.board_id = b.id AND st.is_active = true
    JOIN subjects  s  ON s.standard_id = st.id
    JOIN chapters  c  ON c.subject_id = s.id
    JOIN topics    t  ON t.chapter_id = c.id
    LEFT JOIN content_items ci ON ci.topic_id = t.id
    WHERE b.is_active = true
      AND ${boardF} AND ${gradeF} AND ${subjectF}
    GROUP BY b.id, b.code, b.name, st.grade, s.id, s.name, s.code
    HAVING COUNT(DISTINCT t.id) > 0
    ORDER BY b.code, st.grade, s.name
  `;

  const res = await db.execute(q);
  const rows = (Array.isArray(res) ? res : (res as { rows?: Row[] }).rows ?? []) as Row[];

  const subjects: SummarySubjectRow[] = rows.map((r) => {
    const totalTopics = Number(r.total_topics);
    const okTopics = Number(r.ok_topics);
    const partial: SummarySubjectRow = {
      boardCode: r.board_code,
      boardName: r.board_name,
      grade: Number(r.grade),
      subjectId: Number(r.subject_id),
      subjectName: r.subject_name,
      subjectCode: r.subject_code,
      totalTopics,
      topicsWithAnyContent: Number(r.topics_with_any_content),
      okTopics,
      coveragePct: totalTopics > 0 ? Math.round((okTopics / totalTopics) * 1000) / 10 : 0,
      chapters: Number(r.chapters),
      chaptersWithGoodSrc: Number(r.chapters_with_good_src),
      rowsTotal: Number(r.rows_total),
      rowsPublished: Number(r.rows_published),
      rowsHiQUnpub: Number(r.rows_hi_q_unpub),
      recommendedAction: "inspect", // filled below
    };
    partial.recommendedAction = classify(partial);
    return partial;
  });

  const totals = {
    subjects: subjects.length,
    done: 0,
    publishOnly: 0,
    fanoutOnly: 0,
    bootstrapNeeded: 0,
    inspect: 0,
    /** Sum of hi-q unpublished rows across subjects classified as publish_only. */
    rowsHiQUnpub: 0,
    /** Sum of reusable chapters across subjects classified as fanout_only. */
    chaptersWithGoodSrc: 0,
    /** Sum of hi-q unpublished rows across ALL subjects in scope — free tokens if flipped. */
    rowsHiQUnpubTotal: 0,
  };
  for (const s of subjects) {
    totals.rowsHiQUnpubTotal += s.rowsHiQUnpub;
    switch (s.recommendedAction) {
      case "done":
        totals.done++;
        break;
      case "publish_only":
        totals.publishOnly++;
        totals.rowsHiQUnpub += s.rowsHiQUnpub;
        break;
      case "fanout_only":
        totals.fanoutOnly++;
        totals.chaptersWithGoodSrc += s.chaptersWithGoodSrc;
        break;
      case "bootstrap_needed":
        totals.bootstrapNeeded++;
        break;
      case "inspect":
        totals.inspect++;
        break;
    }
  }

  return { filter, subjects, totals };
}
