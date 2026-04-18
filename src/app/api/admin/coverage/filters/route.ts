import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";

// ---------------------------------------------------------------------------
// GET /api/admin/coverage/filters
// ---------------------------------------------------------------------------
// Returns the full cascading Board → Grade → Subject tree for the Coverage
// page's dropdowns. One shot — the UI doesn't need to fan out multiple
// requests as the user picks each level.
// ---------------------------------------------------------------------------

interface Row {
  board_id: number;
  board_code: string;
  board_name: string;
  standard_id: number;
  grade: number;
  subject_id: number;
  subject_name: string;
  subject_code: string;
  topic_count: number;
}

interface SubjectOption {
  subjectId: number;
  standardId: number;
  name: string;
  code: string;
  topicCount: number;
}

interface GradeOption {
  grade: number;
  standardIds: number[];
  subjects: SubjectOption[];
}

interface BoardOption {
  boardId: number;
  code: string;
  name: string;
  grades: GradeOption[];
}

export async function GET() {
  const session = await auth();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Admin access required" } },
      { status: 403 }
    );
  }

  // One query: join everything with a left join to topics so the count is
  // accurate (including zero). Active subjects only.
  const q = sql`
    SELECT
      b.id                              AS board_id,
      b.code                            AS board_code,
      b.name                            AS board_name,
      st.id                             AS standard_id,
      st.grade                          AS grade,
      s.id                              AS subject_id,
      s.name                            AS subject_name,
      s.code                            AS subject_code,
      COUNT(t.id)::int                  AS topic_count
    FROM boards b
    JOIN standards st ON st.board_id = b.id AND st.is_active = true
    JOIN subjects  s  ON s.standard_id = st.id
    LEFT JOIN chapters c ON c.subject_id = s.id
    LEFT JOIN topics   t ON t.chapter_id = c.id
    WHERE b.is_active = true
    GROUP BY b.id, b.code, b.name, st.id, st.grade, s.id, s.name, s.code
    ORDER BY b.code, st.grade, s.name
  `;
  const res = await db.execute(q);
  const rows = (Array.isArray(res) ? res : (res as { rows?: Row[] }).rows ?? []) as Row[];

  const boardMap = new Map<number, BoardOption>();
  for (const r of rows) {
    // Bigint columns from raw db.execute come back as strings — coerce.
    const boardId = Number(r.board_id);
    const standardId = Number(r.standard_id);
    const subjectId = Number(r.subject_id);
    const grade = Number(r.grade);

    let board = boardMap.get(boardId);
    if (!board) {
      board = {
        boardId,
        code: r.board_code,
        name: r.board_name,
        grades: [],
      };
      boardMap.set(boardId, board);
    }

    let gradeOpt = board.grades.find((g) => g.grade === grade);
    if (!gradeOpt) {
      gradeOpt = { grade, standardIds: [], subjects: [] };
      board.grades.push(gradeOpt);
    }
    if (!gradeOpt.standardIds.includes(standardId)) {
      gradeOpt.standardIds.push(standardId);
    }

    gradeOpt.subjects.push({
      subjectId,
      standardId,
      name: r.subject_name,
      code: r.subject_code,
      topicCount: Number(r.topic_count),
    });
  }

  const boards = Array.from(boardMap.values());
  // Sort grades asc, keep subjects ordered by name (already SQL-sorted)
  for (const b of boards) b.grades.sort((a, c) => a.grade - c.grade);

  return NextResponse.json({
    success: true,
    data: { boards },
  });
}
