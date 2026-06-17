import { NextRequest, NextResponse } from "next/server";
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
  standard_id: number | null;
  grade: number | null;
  academic_year: string | null;
  subject_id: number | null;
  subject_name: string | null;
  subject_code: string | null;
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
  /**
   * Academic year for THIS grade-row, e.g. "2025-26". Pulled onto every
   * grade so the UI can render Class 10 (2025-26) and Class 10 (2026-27)
   * as two separate pickable entries when both exist.
   */
  academicYear: string;
}

interface BoardOption {
  boardId: number;
  code: string;
  name: string;
  grades: GradeOption[];
  /**
   * Distinct academic years that this board's standards span, sorted
   * descending (newest first). The UI uses this to populate the year
   * dropdown — boards with only 2025-26 data show just one entry.
   */
  academicYears: string[];
}

export async function GET(_request: NextRequest) {
  const session = await auth();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Admin access required" } },
      { status: 403 }
    );
  }

  // One query: LEFT JOIN everything downstream of boards so every active board
  // surfaces in the dropdown — even newly-seeded boards that have no standards
  // or subjects yet (e.g. KL_SCERT before its syllabus is ingested). The grade
  // and subject lists will be empty for those boards, which is what we want.
  //
  // We return `academic_year` per row so the client can (a) populate a year
  // dropdown from the DISTINCT values it sees, and (b) filter the visible
  // tree to a single year without a second round-trip. Doing the year cut
  // server-side would force the dropdown into a separate endpoint — more
  // code for no speed benefit at current board counts.
  const q = sql`
    SELECT
      b.id                              AS board_id,
      b.code                            AS board_code,
      b.name                            AS board_name,
      st.id                             AS standard_id,
      st.grade                          AS grade,
      st.academic_year                  AS academic_year,
      s.id                              AS subject_id,
      s.name                            AS subject_name,
      s.code                            AS subject_code,
      COUNT(t.id)::int                  AS topic_count
    FROM boards b
    LEFT JOIN standards st ON st.board_id = b.id AND st.is_active = true
    LEFT JOIN subjects  s  ON s.standard_id = st.id
    LEFT JOIN chapters  c  ON c.subject_id = s.id
    LEFT JOIN topics    t  ON t.chapter_id = c.id
    WHERE b.is_active = true
    GROUP BY b.id, b.code, b.name, st.id, st.grade, st.academic_year, s.id, s.name, s.code
    ORDER BY b.code, st.grade NULLS LAST, s.name NULLS LAST
  `;
  const res = await db.execute(q);
  const rows = (Array.isArray(res) ? res : (res as { rows?: Row[] }).rows ?? []) as Row[];

  const boardMap = new Map<number, BoardOption>();
  for (const r of rows) {
    // Bigint columns from raw db.execute come back as strings — coerce.
    const boardId = Number(r.board_id);

    let board = boardMap.get(boardId);
    if (!board) {
      board = {
        boardId,
        code: r.board_code,
        name: r.board_name,
        grades: [],
        academicYears: [],
      };
      boardMap.set(boardId, board);
    }

    // A board with no standards yet surfaces as a single row with NULL
    // standard/grade/subject — keep the board, skip the grade/subject tree.
    if (r.standard_id == null || r.grade == null) continue;

    const standardId = Number(r.standard_id);
    const grade = Number(r.grade);
    // academic_year has a NOT NULL default in the standards table, but we
    // fall back to "2025-26" defensively in case a legacy row slipped in
    // without one — keeps the UI from rendering a blank chip.
    const academicYear = r.academic_year ?? "2025-26";
    if (!board.academicYears.includes(academicYear)) {
      board.academicYears.push(academicYear);
    }

    // Key grade rows by (grade, year) so Class 10 / 2025-26 and Class 10 /
    // 2026-27 each get their own entry — they're separate standards rows
    // in the DB and the admin needs to distinguish them in the picker.
    let gradeOpt = board.grades.find(
      (g) => g.grade === grade && g.academicYear === academicYear
    );
    if (!gradeOpt) {
      gradeOpt = { grade, standardIds: [], subjects: [], academicYear };
      board.grades.push(gradeOpt);
    }
    if (!gradeOpt.standardIds.includes(standardId)) {
      gradeOpt.standardIds.push(standardId);
    }

    // A standard without subjects yet still appears as a grade node (empty list).
    if (r.subject_id == null) continue;
    const subjectId = Number(r.subject_id);

    gradeOpt.subjects.push({
      subjectId,
      standardId,
      name: r.subject_name ?? "",
      code: r.subject_code ?? "",
      topicCount: Number(r.topic_count),
    });
  }

  const boards = Array.from(boardMap.values());
  // Sort grades asc; tie-break by year desc so the newest year appears first
  // when Class 10 exists for both 2025-26 and 2026-27. Subjects stay in the
  // SQL-sorted order (by name). Academic years list sorts descending — the
  // dropdown shows newest first, which matches how admins think about years.
  for (const b of boards) {
    b.grades.sort(
      (a, c) => a.grade - c.grade || c.academicYear.localeCompare(a.academicYear)
    );
    b.academicYears.sort((a, c) => c.localeCompare(a));
  }

  return NextResponse.json({
    success: true,
    data: { boards },
  });
}
