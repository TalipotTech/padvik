/**
 * Shared topic + content search logic.
 *
 * Factored out of /api/syllabus/search (Drizzle topic title search) and
 * /api/learn/search (raw-SQL published-content full-text search) so the
 * unified /api/learn/topic-search route reuses them instead of duplicating the
 * SQL. Pure data layer (only @/db + drizzle) — reusable by ExamForge.
 */
import { db } from "@/db";
import { and, eq, ilike, or, sql } from "drizzle-orm";
import { boards, standards, subjects, chapters, topics } from "@/db/schema/curriculum";

export interface TopicSearchHit {
  topicId: number;
  title: string;
  chapterTitle: string;
  subjectName: string;
  subjectId: number;
  grade: number;
  boardId: number;
  boardCode: string;
}

export interface ContentSearchHit {
  contentItemId: number;
  title: string;
  contentType: string;
  language: string;
  snippet: string;
  qualityScore: string | null;
  topicId: number;
  topicTitle: string;
  chapterTitle: string;
  subjectName: string;
  grade: number;
  boardCode: string;
}

export interface SearchFilters {
  boardId?: number | null;
  grade?: number | null;
  limit?: number;
}

/**
 * Topic-title match — mirrors /api/syllabus/search (topics+chapter ILIKE),
 * with an added grade filter and exact/prefix-first ranking.
 */
export async function searchTopics(
  q: string,
  { boardId, grade, limit = 20 }: SearchFilters = {}
): Promise<TopicSearchHit[]> {
  const term = q.trim();
  if (term.length < 2) return [];

  const pattern = `%${term}%`;
  const conditions = [or(ilike(topics.title, pattern), ilike(chapters.title, pattern))];

  if (boardId) conditions.push(eq(standards.boardId, boardId));
  if (grade != null) conditions.push(eq(standards.grade, grade));

  const rows = await db
    .select({
      topicId: topics.id,
      title: topics.title,
      chapterTitle: chapters.title,
      subjectName: subjects.name,
      subjectId: subjects.id,
      grade: standards.grade,
      boardId: standards.boardId,
      boardCode: boards.code,
    })
    .from(topics)
    .innerJoin(chapters, eq(topics.chapterId, chapters.id))
    .innerJoin(subjects, eq(chapters.subjectId, subjects.id))
    .innerJoin(standards, eq(subjects.standardId, standards.id))
    .innerJoin(boards, eq(standards.boardId, boards.id))
    .where(and(...conditions))
    // Over-fetch a little so JS ranking has room to reorder before slicing.
    .limit(Math.min(Math.max(limit * 3, limit), 100));

  const lower = term.toLowerCase();
  const rank = (title: string): number => {
    const t = title.toLowerCase();
    if (t === lower) return 0; // exact
    if (t.startsWith(lower)) return 1; // prefix
    return 2; // contains
  };

  return rows
    .sort((a, b) => rank(a.title) - rank(b.title))
    .slice(0, limit);
}

/**
 * Published-content full-text match — mirrors /api/learn/search exactly
 * (ILIKE on title/body with a ~200-char snippet, title-match-first ordering).
 */
export async function searchContent(
  q: string,
  { boardId, grade, limit = 20 }: SearchFilters = {}
): Promise<ContentSearchHit[]> {
  const term = q.trim();
  if (term.length < 2) return [];

  const searchTerm = `%${term}%`;
  const safeLimit = Math.min(Math.max(limit, 1), 50);

  const results = await db.execute<{
    content_item_id: number;
    content_title: string;
    content_type: string;
    language: string;
    snippet: string;
    quality_score: string | null;
    topic_id: number;
    topic_title: string;
    chapter_title: string;
    subject_name: string;
    grade: number;
    board_code: string;
  }>(sql`
    SELECT
      ci.id AS content_item_id,
      ci.title AS content_title,
      ci.content_type,
      ci.language,
      ci.quality_score,
      substring(ci.body FROM greatest(1, position(lower(${term}) in lower(ci.body)) - 80) FOR 200) AS snippet,
      t.id AS topic_id,
      t.title AS topic_title,
      ch.title AS chapter_title,
      s.name AS subject_name,
      st.grade,
      b.code AS board_code
    FROM content_items ci
    JOIN topics t ON t.id = ci.topic_id
    JOIN chapters ch ON ch.id = t.chapter_id
    JOIN subjects s ON s.id = ch.subject_id
    JOIN standards st ON st.id = s.standard_id
    JOIN boards b ON b.id = st.board_id
    WHERE ci.is_published = true
      AND (ci.body ILIKE ${searchTerm} OR ci.title ILIKE ${searchTerm})
      ${boardId ? sql`AND b.id = ${boardId}` : sql``}
      ${grade != null ? sql`AND st.grade = ${grade}` : sql``}
    ORDER BY
      CASE WHEN ci.title ILIKE ${searchTerm} THEN 0 ELSE 1 END,
      ci.quality_score DESC
    LIMIT ${safeLimit}
  `);

  return [...results].map((r) => ({
    contentItemId: r.content_item_id,
    title: r.content_title,
    contentType: r.content_type,
    language: r.language,
    snippet: r.snippet ?? "",
    qualityScore: r.quality_score,
    topicId: r.topic_id,
    topicTitle: r.topic_title,
    chapterTitle: r.chapter_title,
    subjectName: r.subject_name,
    grade: r.grade,
    boardCode: r.board_code,
  }));
}

/**
 * Resolve a board's numeric id → code (for the scope guard's context). Returns
 * null if not found. Cheap single-row lookup.
 */
export async function getBoardCode(boardId: number): Promise<string | null> {
  const [row] = await db
    .select({ code: boards.code })
    .from(boards)
    .where(eq(boards.id, boardId))
    .limit(1);
  return row?.code ?? null;
}
