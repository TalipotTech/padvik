/**
 * Fan-out a chapter's best content row to every sibling topic that has none.
 *
 * Shared core used by both scripts/fan-out-chapter-content.ts (CLI) and
 * /api/admin/coverage/run (admin "Fan-out" action).
 *
 * Safe by design:
 *   - Never overwrites or modifies existing content rows.
 *   - Only writes when an orphan topic has ZERO content_items rows.
 *   - Idempotent: re-running is a no-op once everything's covered.
 *   - Scope is always one chapter at a time — never fans content across chapters.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { contentItems } from "@/db/schema/content";
import type { CoverageFilter } from "./audit";

interface ChapterRow {
  chapter_id: number;
  chapter_number: number;
  chapter_title: string;
  subject_id: number;
  subject_name: string;
  grade: number;
  board_code: string;
  topic_count: number;
  topics_without_content: number;
}

interface BestRow {
  id: number;
  topic_id: number;
  content_type: string | null;
  title: string | null;
  body: string;
  body_format: string | null;
  source_type: string | null;
  source_url: string | null;
  language: string | null;
  quality_score: string | null;
  review_status: string | null;
  is_published: boolean;
  metadata: Record<string, unknown> | null;
}

interface OrphanTopic {
  id: number;
  title: string;
  sort_order: number;
}

export interface FanOutResult {
  chaptersWithOrphans: number;
  chaptersHandled: number;
  chaptersSkippedNoSource: number;
  topicsCloned: number;
  log: string[];
  skipped: Array<{
    boardCode: string;
    grade: number;
    subjectName: string;
    chapterNumber: number;
    chapterTitle: string;
  }>;
}

export interface FanOutOptions {
  dryRun?: boolean;
  /** Optional progress line callback — not required. */
  onLog?: (line: string) => void;
}

export async function fanOutChapterContent(
  filter: CoverageFilter,
  opts: FanOutOptions = {}
): Promise<FanOutResult> {
  const { dryRun = false, onLog } = opts;
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
  const chapterF = filter.chapterNumber
    ? sql`c.chapter_number = ${filter.chapterNumber}`
    : sql`1=1`;

  const q = sql`
    SELECT
      c.id                                                        AS chapter_id,
      c.chapter_number                                            AS chapter_number,
      c.title                                                     AS chapter_title,
      s.id                                                        AS subject_id,
      s.name                                                      AS subject_name,
      st.grade                                                    AS grade,
      b.code                                                      AS board_code,
      count(DISTINCT t.id)::int                                   AS topic_count,
      count(DISTINCT t.id) FILTER (
        WHERE NOT EXISTS (
          SELECT 1 FROM content_items ci2
          WHERE ci2.topic_id = t.id AND ci2.content_type != 'foundation'
        )
      )::int                                                      AS topics_without_content
    FROM chapters c
    JOIN subjects  s  ON s.id  = c.subject_id
    JOIN standards st ON st.id = s.standard_id
    JOIN boards    b  ON b.id  = st.board_id
    JOIN topics    t  ON t.chapter_id = c.id
    WHERE ${boardF} AND ${gradeF} AND ${subjectF} AND ${chapterF}
    GROUP BY c.id, c.chapter_number, c.title, s.id, s.name, st.grade, b.code
    HAVING count(DISTINCT t.id) FILTER (
      WHERE NOT EXISTS (
        SELECT 1 FROM content_items ci2
        WHERE ci2.topic_id = t.id AND ci2.content_type != 'foundation'
      )
    ) > 0
    ORDER BY b.code, st.grade, s.name, c.chapter_number
  `;

  const res = await db.execute(q);
  const chapterRows = (Array.isArray(res) ? res : (res as { rows?: ChapterRow[] }).rows ?? []) as ChapterRow[];

  const result: FanOutResult = {
    chaptersWithOrphans: chapterRows.length,
    chaptersHandled: 0,
    chaptersSkippedNoSource: 0,
    topicsCloned: 0,
    log,
    skipped: [],
  };

  push(`Fan-out ${dryRun ? "DRY-RUN" : "LIVE"}: ${chapterRows.length} chapter(s) have orphan topics.`);

  for (const ch of chapterRows) {
    const label = `[${ch.board_code}] Gr${ch.grade} ${ch.subject_name} Ch${ch.chapter_number} "${ch.chapter_title}"`;
    push(`── ${label}  (${ch.topic_count} topics, ${ch.topics_without_content} orphan)`);

    const bestQ = sql`
      SELECT ci.id, ci.topic_id, ci.content_type, ci.title, ci.body, ci.body_format,
             ci.source_type, ci.source_url, ci.language, ci.quality_score,
             ci.review_status, ci.is_published, ci.metadata
      FROM content_items ci
      JOIN topics t ON t.id = ci.topic_id
      WHERE t.chapter_id = ${ch.chapter_id}
        AND ci.content_type != 'foundation'
        AND ci.is_published = true
        AND ci.review_status NOT IN ('needs_review','rejected')
        AND (ci.quality_score IS NULL OR ci.quality_score::decimal >= 0.5)
        AND ci.body NOT ILIKE '%is not covered in%'
        AND ci.body NOT ILIKE '%not covered in the provided%'
        AND ci.body NOT ILIKE '%does not appear in the%chapter%'
        AND ci.body NOT ILIKE '%cannot find%in the provided%'
        AND ci.body NOT ILIKE '%the provided text does not%'
        AND length(ci.body) > 200
      ORDER BY ci.quality_score::decimal DESC NULLS LAST, length(ci.body) DESC
      LIMIT 1
    `;
    const bestRes = await db.execute(bestQ);
    const bestRows = (Array.isArray(bestRes) ? bestRes : (bestRes as { rows?: BestRow[] }).rows ?? []) as BestRow[];

    if (bestRows.length === 0) {
      push(`    ✗ no qualifying source content — skipping (run bootstrap first)`);
      result.chaptersSkippedNoSource++;
      result.skipped.push({
        boardCode: ch.board_code,
        grade: ch.grade,
        subjectName: ch.subject_name,
        chapterNumber: ch.chapter_number,
        chapterTitle: ch.chapter_title,
      });
      continue;
    }
    const best = bestRows[0];
    push(`    source: ci=${best.id} topic=${best.topic_id} q=${best.quality_score} len=${best.body.length} "${best.title ?? "(untitled)"}"`);

    const orphanQ = sql`
      SELECT t.id, t.title, t.sort_order
      FROM topics t
      WHERE t.chapter_id = ${ch.chapter_id}
        AND NOT EXISTS (
          SELECT 1 FROM content_items ci2
          WHERE ci2.topic_id = t.id AND ci2.content_type != 'foundation'
        )
      ORDER BY t.sort_order, t.id
    `;
    const orphanRes = await db.execute(orphanQ);
    const orphans = (Array.isArray(orphanRes) ? orphanRes : (orphanRes as { rows?: OrphanTopic[] }).rows ?? []) as OrphanTopic[];

    for (const orph of orphans) {
      if (dryRun) {
        push(`    + would clone → topic ${orph.id} "${orph.title}"`);
        result.topicsCloned++;
        continue;
      }

      const baseMeta = (best.metadata ?? {}) as Record<string, unknown>;
      const cloneMeta = {
        ...baseMeta,
        fanOutSource: best.id,
        fanOutAt: new Date().toISOString(),
      };

      // title and sourceType are NOT NULL in the schema — default them.
      await db.insert(contentItems).values({
        topicId: orph.id,
        contentType: best.content_type ?? "note",
        title: best.title ?? orph.title,
        body: best.body,
        bodyFormat: best.body_format ?? "markdown",
        sourceType: best.source_type ?? "fan_out",
        sourceUrl: best.source_url ?? null,
        language: best.language ?? "en",
        qualityScore: best.quality_score,
        reviewStatus: best.review_status ?? "pending",
        isPublished: best.is_published,
        metadata: cloneMeta,
      });

      push(`    ✓ cloned → topic ${orph.id} "${orph.title}"`);
      result.topicsCloned++;
    }

    result.chaptersHandled++;
  }

  push(``);
  push(`Summary: chapters_with_orphans=${result.chaptersWithOrphans} handled=${result.chaptersHandled} skipped_no_source=${result.chaptersSkippedNoSource} topics_cloned=${result.topicsCloned}`);

  return result;
}
