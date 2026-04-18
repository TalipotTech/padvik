import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { auditCoverage, type CoverageFilter } from "@/lib/scraper/coverage";

// ---------------------------------------------------------------------------
// GET /api/admin/coverage
// ---------------------------------------------------------------------------
// Returns the Board→Grade→Subject coverage tree, classifying every topic
// into a bucket (ok | no_row | empty_body | refusal_body | too_short |
// low_quality | bad_review | not_published | unknown).
//
// Query params (all optional, but callers typically pass board+grade+subject
// for a focused view):
//   ?board=CBSE        — board code (exact)
//   &grade=10          — 1..12
//   &subject=100       — subject_id (preferred) OR
//   &subject=Math      — subject name fragment (ILIKE)
//   &chapter=2         — chapter_number within the subject
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Admin access required" } },
      { status: 403 }
    );
  }

  const params = request.nextUrl.searchParams;
  const boardCode = params.get("board") || undefined;
  const gradeRaw = params.get("grade");
  const subjectRaw = params.get("subject") || undefined;
  const chapterRaw = params.get("chapter");

  const grade = gradeRaw ? Number(gradeRaw) : undefined;
  if (gradeRaw && (!Number.isFinite(grade) || grade! < 1 || grade! > 12)) {
    return NextResponse.json(
      { success: false, error: { code: "VALIDATION_ERROR", message: "grade must be 1-12" } },
      { status: 400 }
    );
  }
  const chapterNumber = chapterRaw ? Number(chapterRaw) : undefined;

  const filter: CoverageFilter = { boardCode, grade, chapterNumber };
  if (subjectRaw) {
    const asNum = Number(subjectRaw);
    if (Number.isFinite(asNum) && /^\d+$/.test(subjectRaw)) {
      filter.subjectId = asNum;
    } else {
      filter.subjectName = subjectRaw;
    }
  }

  try {
    const report = await auditCoverage(filter);
    return NextResponse.json({ success: true, data: report });
  } catch (err) {
    console.error("[coverage] audit failed:", err);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "AUDIT_FAILED",
          message: err instanceof Error ? err.message : "Unknown error",
        },
      },
      { status: 500 }
    );
  }
}
