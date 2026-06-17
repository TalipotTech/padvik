import { NextRequest, NextResponse } from "next/server";
import { readdir, stat } from "fs/promises";
import { join } from "path";
import { db } from "@/db";
import { boards, standards, subjects } from "@/db/schema/curriculum";
import { eq } from "drizzle-orm";

/**
 * GET /api/syllabus/source-pdf?subjectId=123
 *
 * Resolves the official board-level syllabus PDF for a subject (e.g. CBSE's
 * "Maths_SecP1X_2026-27.pdf") so the dashboard's "View Complete Syllabus"
 * popup can render the original curriculum document alongside the chapter
 * tree.
 *
 * Resolution order:
 *   1. `subjects.metadata.sourcePdf` — set by the CBSE syllabus scraper
 *      (syllabus-inserter.ts). Trust it when present and the file exists on
 *      disk.
 *   2. Filesystem fallback under `data/pdfs/{boardCode}/{grade}/` — needed
 *      for subjects created by the NCERT Bootstrap flow, which doesn't
 *      populate sourcePdf. We score each PDF in the folder against the
 *      subject name + academic year + grade-roman-numeral and pick the
 *      best match.
 *
 * Response shape:
 *   { success: true, data: {
 *       found: boolean,
 *       pdfUrl?: string,       // "/api/pdfs/CBSE/10/Maths_SecP1X_2026-27.pdf"
 *       filename?: string,     // "Maths_SecP1X_2026-27.pdf"
 *       sourceUrl?: string,    // Original board URL if metadata stored it
 *       resolvedVia: "metadata" | "filesystem" | "none",
 *   }}
 */

// ---------------------------------------------------------------------------
// Scoring heuristics (filesystem fallback)
// ---------------------------------------------------------------------------

const GRADE_ROMAN: Record<number, string> = {
  1: "I",
  2: "II",
  3: "III",
  4: "IV",
  5: "V",
  6: "VI",
  7: "VII",
  8: "VIII",
  9: "IX",
  10: "X",
  11: "XI",
  12: "XII",
};

/**
 * Per-subject aliases. The CBSE scraper names files with compact forms
 * ("Maths" not "Mathematics", "EnglishComm" not "English Communicative"),
 * so we need a short lookup table to bridge the DB name to what's on disk.
 * Kept small and specific — most subjects match their canonical name
 * after normalization, and we don't want an over-eager alias (e.g.
 * "Science" matching "Political Science") to steal the top score.
 */
const SUBJECT_ALIASES: Record<string, string[]> = {
  mathematics: ["maths", "math"],
  "mathematics basic": ["mathsbasic", "maths"],
  "mathematics standard": ["mathsstandard", "maths"],
  "social science": ["socialscience", "sst", "social"],
  "english language and literature": ["englishll", "englishl", "english"],
  "english communicative": ["englishcomm", "english"],
  "hindi course a": ["hindia", "hindi"],
  "hindi course b": ["hindib", "hindi"],
  "computer applications": ["computerapp", "computer"],
  "information technology": ["informationtech", "it"],
  "artificial intelligence": ["ai", "artificialintelligence"],
  "physical education": ["physicaled", "physicaleducation"],
};

/** Normalise "Mathematics (Standard)" → "mathematics standard". */
function normalizeSubjectName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[()]/g, " ")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Strip non-alphanumerics + lowercase so "Maths_SecP1X" matches "mathssecp1x". */
function compact(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

interface Candidate {
  filename: string;
  score: number;
  reasons: string[];
}

/**
 * Score a filename against (subjectName, grade, academicYear). Higher is
 * better. Negative scores eliminate the candidate (e.g. mark-scheme PDFs).
 */
function scoreFilename(
  filename: string,
  subjectName: string,
  grade: number,
  academicYear: string,
): Candidate {
  const reasons: string[] = [];
  let score = 0;

  const base = filename.replace(/\.pdf$/i, "");
  const compactName = compact(base);
  const normalized = normalizeSubjectName(subjectName);
  const subjectTokens = [
    compact(normalized),
    ...(SUBJECT_ALIASES[normalized] ?? []),
    ...normalized.split(" ").filter((t) => t.length >= 3),
  ];

  // Academic year is the strongest signal — filenames with "2026-27" near
  // the end are the current session's syllabus documents.
  if (compactName.includes(compact(academicYear))) {
    score += 20;
    reasons.push(`year:${academicYear}`);
  }

  // Disqualifiers — mark schemes (-MS), sample question papers (-SQP),
  // and legacy short-form files (MathsX.pdf) are NOT the syllabus document.
  if (/-(MS|SQP)(_|\.|$)/i.test(filename)) {
    score -= 100;
    reasons.push("marksheet/sqp");
  }
  if (/_(MS|SQP)(_|\.|$)/i.test(filename)) {
    score -= 100;
    reasons.push("marksheet/sqp");
  }

  // Prefer the "_Sec" convention (curriculum/syllabus files).
  if (/_Sec(P\d+)?[IVX]*_?/i.test(filename)) {
    score += 5;
    reasons.push("sec-convention");
  }

  // Grade roman numeral. The P1/P2 prefix is Part 1/Part 2 (combined-class
  // syllabi); we still want to match on the trailing roman numeral.
  const roman = GRADE_ROMAN[grade];
  if (roman) {
    // Look for "_Sec" + optional "P\d+" + roman followed by underscore/end.
    // This pins to the *right* class rather than matching "IX" inside "XI".
    const re = new RegExp(`_Sec(?:P\\d+)?${roman}(?:_|\\b)`, "i");
    if (re.test(filename)) {
      score += 10;
      reasons.push(`grade:${roman}`);
    }
  }

  // Subject-name token match. Any alias contributes; the longest-matching
  // token wins the tiebreaker so "MathsStandard" beats "Maths" for
  // "Mathematics Standard" subjects.
  let bestTokenLen = 0;
  for (const token of subjectTokens) {
    if (token.length < 3) continue;
    if (compactName.includes(token)) {
      bestTokenLen = Math.max(bestTokenLen, token.length);
      reasons.push(`tok:${token}`);
    }
  }
  score += bestTokenLen;

  return { filename, score, reasons };
}

/**
 * Try to pick the best PDF in a directory for (subject, grade, year).
 * Returns null if no candidate scored above 0 (i.e. nothing looked like a
 * plausible syllabus file).
 */
async function findBestSyllabusPdf(
  dirAbsPath: string,
  subjectName: string,
  grade: number,
  academicYear: string,
): Promise<string | null> {
  let entries: string[];
  try {
    entries = await readdir(dirAbsPath);
  } catch {
    return null;
  }
  const pdfs = entries.filter((f) => f.toLowerCase().endsWith(".pdf"));
  if (pdfs.length === 0) return null;

  const scored = pdfs
    .map((f) => scoreFilename(f, subjectName, grade, academicYear))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored[0]?.filename ?? null;
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  const subjectIdRaw = req.nextUrl.searchParams.get("subjectId");
  const subjectId = subjectIdRaw ? parseInt(subjectIdRaw, 10) : NaN;
  if (!Number.isFinite(subjectId)) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "INVALID_ID", message: "subjectId query param required" },
      },
      { status: 400 },
    );
  }

  // Join up to the board so we can build the filesystem path.
  const rows = await db
    .select({
      subjectName: subjects.name,
      metadata: subjects.metadata,
      grade: standards.grade,
      academicYear: standards.academicYear,
      boardCode: boards.code,
    })
    .from(subjects)
    .innerJoin(standards, eq(subjects.standardId, standards.id))
    .innerJoin(boards, eq(standards.boardId, boards.id))
    .where(eq(subjects.id, subjectId))
    .limit(1);

  if (rows.length === 0) {
    return NextResponse.json(
      { success: false, error: { code: "NOT_FOUND", message: "Subject not found" } },
      { status: 404 },
    );
  }

  const { subjectName, metadata, grade, academicYear, boardCode } = rows[0];
  const meta = (metadata as Record<string, unknown> | null) ?? {};
  const sourceUrl = typeof meta.sourceUrl === "string" ? meta.sourceUrl : undefined;

  // ---- 1. Trust metadata.sourcePdf if it points at a real file ----------
  const metaPdf = typeof meta.sourcePdf === "string" ? meta.sourcePdf : null;
  if (metaPdf) {
    // Stored as a relative path like "data/pdfs/CBSE/10/Maths_SecIX_2025-26RM.pdf".
    // Normalise slashes so Windows-backslash paths from the scraper still match.
    const normalised = metaPdf.replace(/\\/g, "/").replace(/^\/+/, "");
    const absPath = join(process.cwd(), normalised);
    try {
      const st = await stat(absPath);
      if (st.isFile()) {
        // /api/pdfs/[...path] strips the leading "data/pdfs/" prefix, so we
        // re-derive what goes after it.
        const apiPath = normalised.replace(/^data\/pdfs\//, "");
        return NextResponse.json({
          success: true,
          data: {
            found: true,
            pdfUrl: `/api/pdfs/${apiPath}`,
            filename: apiPath.split("/").pop(),
            sourceUrl,
            resolvedVia: "metadata",
          },
        });
      }
    } catch {
      // Fall through to filesystem scan — the path may be stale.
    }
  }

  // ---- 2. Filesystem fallback: scan data/pdfs/{boardCode}/{grade}/ ------
  const dir = join(process.cwd(), "data", "pdfs", boardCode, String(grade));
  const best = await findBestSyllabusPdf(dir, subjectName, grade, academicYear);
  if (best) {
    return NextResponse.json({
      success: true,
      data: {
        found: true,
        pdfUrl: `/api/pdfs/${boardCode}/${grade}/${best}`,
        filename: best,
        sourceUrl,
        resolvedVia: "filesystem",
      },
    });
  }

  return NextResponse.json({
    success: true,
    data: {
      found: false,
      sourceUrl,
      resolvedVia: "none",
    },
  });
}
