import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { summarizeCoverage, type SummaryFilter } from "@/lib/scraper/coverage";

// ---------------------------------------------------------------------------
// GET /api/admin/coverage/summary
// ---------------------------------------------------------------------------
// Returns one row per (board, grade, subject) with counts + recommendedAction.
// Powers the Coverage page's Summary tab grid — cheap single-query aggregate
// that lets admins see what's free to finish (publish_only / fanout_only) vs.
// what truly needs token-costly bootstrap.
//
// Query params (all optional; omit = include everything):
//   ?board=CBSE        — board code (exact)
//   &grade=10          — 1..12
//   &subject=Math      — name fragment (ILIKE)
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
  const subjectName = params.get("subject") || undefined;

  const grade = gradeRaw ? Number(gradeRaw) : undefined;
  if (gradeRaw && (!Number.isFinite(grade) || grade! < 1 || grade! > 12)) {
    return NextResponse.json(
      { success: false, error: { code: "VALIDATION_ERROR", message: "grade must be 1-12" } },
      { status: 400 }
    );
  }

  const filter: SummaryFilter = { boardCode, grade, subjectName };

  try {
    const report = await summarizeCoverage(filter);
    return NextResponse.json({ success: true, data: report });
  } catch (err) {
    console.error("[coverage/summary] failed:", err);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "SUMMARY_FAILED",
          message: err instanceof Error ? err.message : "Unknown error",
        },
      },
      { status: 500 }
    );
  }
}
