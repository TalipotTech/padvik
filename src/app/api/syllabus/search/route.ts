import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { boards, standards, subjects, chapters, topics } from "@/db/schema/curriculum";
import { and, eq, ilike, or } from "drizzle-orm";

// ---------------------------------------------------------------------------
// GET /api/syllabus/search?q=quadratic&boardId=1&limit=20
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim();

  if (!q) {
    return NextResponse.json(
      { success: false, error: { code: "MISSING_PARAM", message: "q query param is required" } },
      { status: 400 },
    );
  }

  const boardIdParam = url.searchParams.get("boardId");
  const boardId = boardIdParam ? parseInt(boardIdParam, 10) : null;
  const limitParam = url.searchParams.get("limit");
  const limit = Math.min(Math.max(parseInt(limitParam ?? "20", 10) || 20, 1), 100);

  const pattern = `%${q}%`;

  const conditions = [
    or(ilike(topics.title, pattern), ilike(chapters.title, pattern)),
  ];

  if (boardId && !isNaN(boardId)) {
    conditions.push(eq(standards.boardId, boardId));
  }

  const rows = await db
    .select({
      topic: topics,
      chapter: chapters,
      subject: subjects,
      standard: standards,
      board: boards,
    })
    .from(topics)
    .innerJoin(chapters, eq(topics.chapterId, chapters.id))
    .innerJoin(subjects, eq(chapters.subjectId, subjects.id))
    .innerJoin(standards, eq(subjects.standardId, standards.id))
    .innerJoin(boards, eq(standards.boardId, boards.id))
    .where(and(...conditions))
    .limit(limit);

  const results = rows.map((r) => ({
    ...r.topic,
    chapter: r.chapter,
    subject: r.subject,
    standard: r.standard,
    board: r.board,
  }));

  return NextResponse.json({ success: true, data: results });
}
