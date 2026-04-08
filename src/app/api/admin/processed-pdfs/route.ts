import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { sql } from "drizzle-orm";

/**
 * GET /api/admin/processed-pdfs?boardCode=CBSE&grade=10
 *
 * Lists all subjects that have a source PDF in their metadata,
 * along with chapter/topic counts and the PDF file paths.
 * This creates the link between scraped PDFs and the syllabus.
 */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Admin access required" } },
      { status: 403 }
    );
  }

  const url = new URL(request.url);
  const boardCode = url.searchParams.get("boardCode");
  const gradeParam = url.searchParams.get("grade");
  const grade = gradeParam ? parseInt(gradeParam, 10) : null;

  try {
    // Query subjects with source PDF metadata, joining to hierarchy
    const pdfs = await db.execute<{
      subject_id: number;
      subject_name: string;
      subject_code: string;
      board_code: string;
      board_name: string;
      grade: number;
      stream: string | null;
      pdf_path: string | null;
      text_path: string | null;
      source_url: string | null;
      ai_model: string | null;
      scrape_job_id: number | null;
      review_status: string | null;
      parsed_at: string | null;
      chapter_count: number;
      topic_count: number;
      content_count: number;
      question_count: number;
    }>(sql`
      SELECT
        sub.id AS subject_id,
        sub.name AS subject_name,
        sub.code AS subject_code,
        b.code AS board_code,
        b.name AS board_name,
        st.grade,
        st.stream,
        sub.metadata->>'sourcePdf' AS pdf_path,
        sub.metadata->>'sourceText' AS text_path,
        sub.metadata->>'sourceUrl' AS source_url,
        sub.metadata->>'aiModel' AS ai_model,
        (sub.metadata->>'scrapeJobId')::int AS scrape_job_id,
        sub.metadata->>'reviewStatus' AS review_status,
        sub.metadata->>'parsedAt' AS parsed_at,
        (SELECT count(*)::int FROM chapters WHERE subject_id = sub.id) AS chapter_count,
        (SELECT count(*)::int FROM topics t JOIN chapters c ON c.id = t.chapter_id WHERE c.subject_id = sub.id) AS topic_count,
        (SELECT count(*)::int FROM content_items ci JOIN topics t2 ON t2.id = ci.topic_id JOIN chapters c2 ON c2.id = t2.chapter_id WHERE c2.subject_id = sub.id) AS content_count,
        (SELECT count(*)::int FROM questions q JOIN topics t3 ON t3.id = q.topic_id JOIN chapters c3 ON c3.id = t3.chapter_id WHERE c3.subject_id = sub.id) AS question_count
      FROM subjects sub
      JOIN standards st ON st.id = sub.standard_id
      JOIN boards b ON b.id = st.board_id
      WHERE sub.metadata->>'sourcePdf' IS NOT NULL
      ${boardCode ? sql`AND b.code = ${boardCode}` : sql``}
      ${grade ? sql`AND st.grade = ${grade}` : sql``}
      ORDER BY b.code, st.grade, sub.name
    `);

    // Also get summary counts per board/grade
    const summary = await db.execute<{
      board_code: string;
      grade: number;
      pdf_count: number;
      total_chapters: number;
      total_topics: number;
      total_content: number;
      total_questions: number;
    }>(sql`
      SELECT
        b.code AS board_code,
        st.grade,
        count(DISTINCT sub.id)::int AS pdf_count,
        count(DISTINCT ch.id)::int AS total_chapters,
        count(DISTINCT t.id)::int AS total_topics,
        (SELECT count(*)::int FROM content_items ci2 JOIN topics t2 ON t2.id = ci2.topic_id JOIN chapters c2 ON c2.id = t2.chapter_id JOIN subjects s2 ON s2.id = c2.subject_id WHERE s2.standard_id = st.id AND s2.metadata->>'sourcePdf' IS NOT NULL) AS total_content,
        (SELECT count(*)::int FROM questions q2 JOIN topics t3 ON t3.id = q2.topic_id JOIN chapters c3 ON c3.id = t3.chapter_id JOIN subjects s3 ON s3.id = c3.subject_id WHERE s3.standard_id = st.id AND s3.metadata->>'sourcePdf' IS NOT NULL) AS total_questions
      FROM subjects sub
      JOIN standards st ON st.id = sub.standard_id
      JOIN boards b ON b.id = st.board_id
      LEFT JOIN chapters ch ON ch.subject_id = sub.id
      LEFT JOIN topics t ON t.chapter_id = ch.id
      WHERE sub.metadata->>'sourcePdf' IS NOT NULL
      GROUP BY b.code, st.grade, st.id
      ORDER BY b.code, st.grade
    `);

    return NextResponse.json({
      success: true,
      data: {
        pdfs: [...pdfs],
        summary: [...summary],
        totalPdfs: [...pdfs].length,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: { code: "QUERY_ERROR", message: err instanceof Error ? err.message : String(err) } },
      { status: 500 }
    );
  }
}
