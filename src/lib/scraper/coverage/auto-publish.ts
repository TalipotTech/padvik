/**
 * Auto-publish high-quality NCERT content rows that landed as pending/unpublished.
 *
 * Shared core used by scripts/auto-publish-high-quality-ncert.ts (CLI) and
 * /api/admin/coverage/run (admin "Publish" action).
 *
 * Matches the auto-approve criteria baked into ncert-downloader.ts at insert
 * time (quality_score >= 0.7, not refusal, not foundation, body length > 100).
 * This remediates rows that predate the downloader change.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import type { CoverageFilter } from "./audit";

interface CandidateRow {
  id: number;
  topic_id: number;
  quality_score: string;
  is_published: boolean;
  review_status: string;
  body_len: number;
  topic_title: string;
  chapter_number: number;
  chapter_title: string;
  subject_name: string;
  grade: number;
  board_code: string;
}

export interface AutoPublishResult {
  candidates: number;
  updated: number;
  dryRun: boolean;
  log: string[];
  sample: Array<{
    contentItemId: number;
    topicId: number;
    qualityScore: string;
    bodyLength: number;
    label: string;
  }>;
}

export interface AutoPublishOptions {
  dryRun?: boolean;
  /** Quality floor (default 0.7). */
  qualityFloor?: number;
  onLog?: (line: string) => void;
}

export async function autoPublishHighQualityNcert(
  filter: CoverageFilter,
  opts: AutoPublishOptions = {}
): Promise<AutoPublishResult> {
  const { dryRun = false, qualityFloor = 0.7, onLog } = opts;
  const log: string[] = [];
  const push = (line: string) => {
    log.push(line);
    onLog?.(line);
  };

  const boardF = filter.boardCode ? sql`b.code = ${filter.boardCode}` : sql`1=1`;
  const gradeF = filter.grade ? sql`st.grade = ${filter.grade}` : sql`1=1`;
  const subjectF = filter.subjectId
    ? sql`s.id = ${filter.subjectId}`
    : filter.subjectName
    ? sql`LOWER(s.name) LIKE ${"%" + filter.subjectName.toLowerCase() + "%"}`
    : sql`1=1`;

  const selectQ = sql`
    SELECT ci.id, ci.topic_id, ci.quality_score, ci.is_published, ci.review_status,
           length(ci.body) AS body_len,
           t.title AS topic_title,
           c.chapter_number, c.title AS chapter_title,
           s.name AS subject_name, st.grade, b.code AS board_code
    FROM content_items ci
    JOIN topics    t  ON t.id  = ci.topic_id
    JOIN chapters  c  ON c.id  = t.chapter_id
    JOIN subjects  s  ON s.id  = c.subject_id
    JOIN standards st ON st.id = s.standard_id
    JOIN boards    b  ON b.id  = st.board_id
    WHERE ${boardF} AND ${gradeF} AND ${subjectF}
      AND ci.source_type = 'ncert'
      AND ci.source_url LIKE 'https://ncert.nic.in/%'
      AND ci.quality_score IS NOT NULL
      AND ci.quality_score::decimal >= ${qualityFloor}
      AND ci.is_published = false
      AND ci.review_status NOT IN ('rejected','auto_approved')
      AND ci.content_type != 'foundation'
      AND length(ci.body) > 100
      AND ci.body NOT ILIKE '%is not covered in%'
      AND ci.body NOT ILIKE '%not covered in the provided%'
      AND ci.body NOT ILIKE '%does not appear in the%chapter%'
      AND ci.body NOT ILIKE '%cannot find%in the provided%'
      AND ci.body NOT ILIKE '%the provided text does not%'
    ORDER BY b.code, st.grade, s.name, c.chapter_number, ci.id
  `;

  const res = await db.execute(selectQ);
  const rows = (Array.isArray(res) ? res : (res as { rows?: CandidateRow[] }).rows ?? []) as CandidateRow[];

  push(`Auto-publish ${dryRun ? "DRY-RUN" : "LIVE"}: ${rows.length} candidate row(s) (q>=${qualityFloor}).`);

  const sample = rows.slice(0, 50).map((r) => ({
    contentItemId: r.id,
    topicId: r.topic_id,
    qualityScore: r.quality_score,
    bodyLength: r.body_len,
    label: `[${r.board_code}] Gr${r.grade} ${r.subject_name} Ch${r.chapter_number} "${r.chapter_title}" / ${r.topic_title}`,
  }));

  if (rows.length === 0 || dryRun) {
    return { candidates: rows.length, updated: 0, dryRun, log, sample };
  }

  let updated = 0;
  for (const r of rows) {
    await db.execute(sql`
      UPDATE content_items
      SET is_published = true,
          review_status = 'auto_approved',
          updated_at = NOW()
      WHERE id = ${r.id}
    `);
    updated++;
  }

  push(`✓ Updated ${updated} row(s): is_published=true, review_status='auto_approved'`);
  return { candidates: rows.length, updated, dryRun, log, sample };
}
