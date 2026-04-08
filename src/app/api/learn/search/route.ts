import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { sql } from "drizzle-orm";

/**
 * GET /api/learn/search?q=quadratic&boardId=1&grade=10
 *
 * Full-text search across published content items.
 * Returns matching content with surrounding context snippets.
 */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session && process.env.NODE_ENV !== "development") {
    return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Login required" } }, { status: 401 });
  }

  const url = new URL(request.url);
  const query = url.searchParams.get("q");
  const boardId = url.searchParams.get("boardId");
  const grade = url.searchParams.get("grade");
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "20", 10), 50);

  if (!query || query.trim().length < 2) {
    return NextResponse.json({ success: false, error: { code: "QUERY_TOO_SHORT", message: "Search query must be at least 2 characters" } }, { status: 400 });
  }

  const searchTerm = `%${query.trim()}%`;

  try {
    const results = await db.execute<{
      content_item_id: number;
      content_title: string;
      content_type: string;
      source_type: string;
      language: string;
      snippet: string;
      topic_id: number;
      topic_title: string;
      chapter_title: string;
      chapter_number: number;
      subject_name: string;
      grade: number;
      board_code: string;
    }>(sql`
      SELECT
        ci.id AS content_item_id,
        ci.title AS content_title,
        ci.content_type,
        ci.source_type,
        ci.language,
        -- Extract a snippet of ~160 chars around the match
        substring(ci.body FROM greatest(1, position(lower(${query}) in lower(ci.body)) - 80) FOR 200) AS snippet,
        t.id AS topic_id,
        t.title AS topic_title,
        ch.title AS chapter_title,
        ch.chapter_number,
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
        ${boardId ? sql`AND b.id = ${parseInt(boardId, 10)}` : sql``}
        ${grade ? sql`AND st.grade = ${parseInt(grade, 10)}` : sql``}
      ORDER BY
        -- Prioritize title matches over body matches
        CASE WHEN ci.title ILIKE ${searchTerm} THEN 0 ELSE 1 END,
        ci.quality_score DESC
      LIMIT ${limit}
    `);

    return NextResponse.json({
      success: true,
      data: {
        results: [...results],
        query: query.trim(),
        count: [...results].length,
      },
    });
  } catch (err) {
    return NextResponse.json({
      success: false,
      error: { code: "SEARCH_ERROR", message: err instanceof Error ? err.message : String(err) },
    }, { status: 500 });
  }
}
