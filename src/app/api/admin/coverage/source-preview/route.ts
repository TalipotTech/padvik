import { NextRequest, NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { subjects as subjectsTable, standards as standardsTable } from "@/db/schema/curriculum";
import { filterCatalog } from "@/lib/scraper/ncert-downloader";
import { ACADEMIC_YEAR_REGEX } from "@/lib/academic-year";

// ---------------------------------------------------------------------------
// GET /api/admin/coverage/source-preview
// ---------------------------------------------------------------------------
// Pre-flight dual-source check for the Coverage page. Reports whether NCERT
// has a textbook AND whether a CBSE textbook PDF has already been scraped
// (and parsed) for the given subject, then recommends ONE next action so the
// admin never has to guess which button to click.
//
// Why both sources:
//   NCERT publishes textbooks for core academic subjects (Math, Science, SST,
//   English, Hindi). CBSE publishes its own PDFs at cbseacademic.nic.in for
//   skill/elective subjects NCERT never prints (Computer Applications, AI,
//   Painting, etc.). A subject exists in exactly one of these worlds, and
//   this endpoint tells the UI which one.
//
// Query params:
//   ?grade=10              — required, 1..12
//   &subject=Mathematics   — required (one of subject OR subjectId)
//   &subjectId=42          — alternative: resolves name via DB lookup
//
// Response shape (on success):
//   {
//     grade, subject, subjectId,
//     ncert: { available, books:[], totalChapters },
//     cbseTextbook: {
//       available,                  // has a source PDF been scraped & parsed?
//       sourcePdf, sourceUrl,
//       parsedChapters, parsedAt,
//       totalTopics,
//       topicsWithContent,          // topics that already have any content_items row
//       topicsMissing,              // totalTopics − topicsWithContent
//     },
//     recommendedAction:
//       | "generate_from_cbse"  // CBSE PDF is parsed, topics missing content → run fill-gaps
//       | "bootstrap_ncert"      // NCERT has a book → Bootstrap
//       | "upload_manual"        // neither; admin must upload or AI-generate
//       | "none"                 // everything already covered
//     message, suggestions[],
//     looksLikeSkillSubject
//   }
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
  const gradeRaw = params.get("grade");
  const subjectParam = params.get("subject");
  const subjectIdRaw = params.get("subjectId");
  const academicYearParam = params.get("academicYear");

  const grade = gradeRaw ? Number(gradeRaw) : NaN;
  if (!Number.isFinite(grade) || grade < 1 || grade > 12) {
    return NextResponse.json(
      { success: false, error: { code: "VALIDATION_ERROR", message: "grade (1-12) is required" } },
      { status: 400 }
    );
  }

  // Optional caller-supplied year. Validated here rather than trusted blind
  // because this value ends up in the user-visible recommendation message.
  const academicYearFilter =
    academicYearParam && ACADEMIC_YEAR_REGEX.test(academicYearParam)
      ? academicYearParam
      : null;

  // Resolve subject — need both name (for NCERT catalog match) and id (for
  // DB queries about CBSE PDFs / topic counts). Also pull the owning
  // standard's academicYear so the recommendation message can tell the
  // admin which session the bootstrap will land rows under.
  let subjectName: string | undefined;
  let subjectId: number | undefined;
  let subjectMetadata: Record<string, unknown> | null = null;
  let subjectAcademicYear: string | null = null;

  if (subjectIdRaw) {
    const sid = Number(subjectIdRaw);
    if (Number.isFinite(sid)) {
      const [row] = await db
        .select({
          id: subjectsTable.id,
          name: subjectsTable.name,
          metadata: subjectsTable.metadata,
          academicYear: standardsTable.academicYear,
        })
        .from(subjectsTable)
        .innerJoin(standardsTable, eq(standardsTable.id, subjectsTable.standardId))
        .where(eq(subjectsTable.id, sid))
        .limit(1);
      if (row) {
        subjectId = row.id;
        subjectName = row.name;
        subjectMetadata = (row.metadata as Record<string, unknown>) ?? null;
        subjectAcademicYear = row.academicYear ?? null;
      }
    }
  }
  if (!subjectName && subjectParam) {
    subjectName = subjectParam;
  }
  if (!subjectName) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "VALIDATION_ERROR", message: "subject or subjectId is required" },
      },
      { status: 400 }
    );
  }

  // -------------------------------------------------------------------------
  // NCERT catalog match (substring on subject name / subjectCode / name).
  // Same filter the worker uses, so a match here means the worker will
  // actually find something to download.
  // -------------------------------------------------------------------------
  const books = filterCatalog({
    grades: [grade],
    subjects: [subjectName],
    languages: ["en"],
  });
  const ncertChapters = books.reduce((n, b) => n + b.chapters, 0);
  const ncertAvailable = books.length > 0;

  // -------------------------------------------------------------------------
  // CBSE textbook availability. The CBSE syllabus scraper writes the PDF path
  // into subjects.metadata.sourcePdf AND chapters.metadata.sourcePdf. If
  // either is present, the PDF has been downloaded; we additionally verify
  // that chapters were actually parsed out of it and count how many topics
  // still need content_items rows.
  // -------------------------------------------------------------------------
  type CbseRow = {
    source_pdf: string | null;
    source_url: string | null;
    parsed_at: string | null;
    parsed_chapters: number;
    total_topics: number;
    topics_with_content: number;
  };
  let cbseRow: CbseRow | null = null;
  if (subjectId !== undefined) {
    const result = await db.execute<CbseRow>(sql`
      SELECT
        COALESCE(s.metadata->>'sourcePdf',
                 (SELECT ch.metadata->>'sourcePdf' FROM chapters ch WHERE ch.subject_id = s.id AND ch.metadata->>'sourcePdf' IS NOT NULL LIMIT 1)
        ) AS source_pdf,
        s.metadata->>'sourceUrl' AS source_url,
        s.metadata->>'parsedAt' AS parsed_at,
        (SELECT count(*)::int FROM chapters ch WHERE ch.subject_id = s.id) AS parsed_chapters,
        (SELECT count(*)::int FROM topics t JOIN chapters ch ON ch.id = t.chapter_id WHERE ch.subject_id = s.id) AS total_topics,
        (SELECT count(DISTINCT t.id)::int
           FROM topics t
           JOIN chapters ch ON ch.id = t.chapter_id
           JOIN content_items ci ON ci.topic_id = t.id
          WHERE ch.subject_id = s.id
        ) AS topics_with_content
      FROM subjects s
      WHERE s.id = ${subjectId}
    `);
    const rows = (Array.isArray(result) ? result : (result as { rows?: CbseRow[] }).rows ?? []) as CbseRow[];
    cbseRow = rows[0] ?? null;
  }

  // A "CBSE textbook" is considered available only when BOTH a source PDF is
  // on disk AND chapters have been parsed out of it. A PDF without chapters
  // is a half-done scrape — we report it differently to the admin.
  const cbseSourcePdf = cbseRow?.source_pdf ?? null;
  const cbseParsedChapters = cbseRow?.parsed_chapters ?? 0;
  const cbseTotalTopics = cbseRow?.total_topics ?? 0;
  const cbseTopicsWithContent = cbseRow?.topics_with_content ?? 0;
  const cbseTopicsMissing = Math.max(0, cbseTotalTopics - cbseTopicsWithContent);
  const cbseAvailable = !!cbseSourcePdf && cbseParsedChapters > 0;

  // -------------------------------------------------------------------------
  // Skill-subject heuristic — drives the "upload manual" copy when neither
  // source has anything.
  // -------------------------------------------------------------------------
  const lower = subjectName.toLowerCase();
  const skillHints = [
    "computer",
    "information technology",
    "artificial intelligence",
    "painting",
    "music",
    "dance",
    "physical education",
    "health",
    "entrepreneurship",
    "commerce",
    "retail",
    "automobile",
    "tourism",
  ];
  const looksLikeSkillSubject = skillHints.some((h) => lower.includes(h));

  // -------------------------------------------------------------------------
  // Pick the ONE next action. Priority order:
  //   1. CBSE PDF is parsed + topics are missing content → fill-gaps (cheap,
  //      uses real textbook text). This outranks NCERT because the admin
  //      has already invested in downloading & parsing the CBSE PDF.
  //   2. CBSE PDF parsed and every topic already has content → "none". We
  //      DO NOT fall through to bootstrap_ncert here even when NCERT also
  //      has a book, because that would nag the admin to re-do work that's
  //      already done. NCERT is still surfaced as an optional suggestion.
  //   3. NCERT has a book (and CBSE isn't already complete) → Bootstrap.
  //   4. Otherwise → upload_manual (explain and point to alternatives).
  // -------------------------------------------------------------------------
  type RecommendedAction =
    | "generate_from_cbse"
    | "bootstrap_ncert"
    | "upload_manual"
    | "none";
  let recommendedAction: RecommendedAction;
  let message: string;
  const suggestions: string[] = [];

  // Year context for the recommendation copy. Caller-supplied filter wins
  // (the Detail tab pins an explicit year); otherwise we fall back to the
  // year the subject's standard is already tagged with. Rendered in parens
  // after the grade so the admin sees "Grade 10 (2026-27) Mathematics: ..."
  // without an extra chip.
  const yearContext = academicYearFilter ?? subjectAcademicYear;
  const yearSuffix = yearContext ? ` (${yearContext})` : "";

  if (cbseAvailable && cbseTopicsMissing > 0) {
    recommendedAction = "generate_from_cbse";
    message = `CBSE textbook already scraped for Grade ${grade}${yearSuffix} (${cbseParsedChapters} chapters, ${cbseTotalTopics} topics). ${cbseTopicsMissing} topic(s) still need content — run Generate from CBSE to extract them directly from the downloaded PDF.`;
    if (ncertAvailable) {
      suggestions.push(
        `NCERT also has ${books.length} book(s) for this subject — you can run Bootstrap NCERT afterwards to layer textbook content on top.`
      );
    }
  } else if (cbseAvailable && cbseTopicsMissing === 0) {
    // CBSE-complete wins over NCERT availability. Otherwise the button would
    // keep saying "Bootstrap NCERT" even on fully-ingested subjects, which
    // is the bug from the 2026-04-19 feedback.
    recommendedAction = "none";
    message = `All ${cbseTotalTopics} topic(s) already have content from the CBSE textbook for Grade ${grade}${yearSuffix}. Nothing to bootstrap — run Auto-publish (step 3) to flip high-quality pending rows to visible.`;
    if (ncertAvailable) {
      suggestions.push(
        `NCERT also publishes ${books.length} book(s) for this subject — Bootstrap NCERT would layer additional textbook content on top if you want richer coverage.`
      );
    }
  } else if (ncertAvailable) {
    recommendedAction = "bootstrap_ncert";
    message =
      books.length === 1
        ? `NCERT has 1 book for Grade ${grade}${yearSuffix} ${subjectName}: "${books[0].name}" (${books[0].chapters} chapters). Bootstrap will download and parse it.`
        : `NCERT has ${books.length} books for Grade ${grade}${yearSuffix} ${subjectName} (${ncertChapters} chapters total). Bootstrap will download and parse them all.`;
  } else if (looksLikeSkillSubject) {
    recommendedAction = "upload_manual";
    message = `NCERT does not publish a textbook for "${subjectName}" at Grade ${grade}${yearSuffix}, and no CBSE PDF has been scraped yet. This subject's curriculum is published by CBSE as a syllabus document — use the CBSE Syllabus scraper or upload content manually.`;
    suggestions.push(
      "Run the CBSE Syllabus scraper (Scrape Jobs → Syllabus) to fetch the CBSE PDF for this subject.",
      "Or upload custom content via Content Review.",
      "Or mark this subject as 'manual' and generate content with AI Content Generator."
    );
  } else {
    recommendedAction = "upload_manual";
    message = `No NCERT book matches Grade ${grade}${yearSuffix} "${subjectName}", and no CBSE textbook has been scraped for it yet. The subject-name mapping may differ from NCERT's naming, or this may be a state-board-only subject.`;
    suggestions.push(
      "Check /scrape-jobs → NCERT Download for the full subject list.",
      "Run the CBSE Syllabus scraper if this is a CBSE elective.",
      "Use a state-board scraper or the AI Content Generator as a fallback."
    );
  }

  return NextResponse.json({
    success: true,
    data: {
      grade,
      subject: subjectName,
      subjectId: subjectId ?? null,
      ncert: {
        available: ncertAvailable,
        books: books.map((b) => ({
          code: b.code,
          name: b.name,
          chapters: b.chapters,
          language: b.language,
        })),
        totalChapters: ncertChapters,
      },
      cbseTextbook: {
        available: cbseAvailable,
        sourcePdf: cbseSourcePdf,
        sourceUrl: cbseRow?.source_url ?? null,
        parsedAt: cbseRow?.parsed_at ?? null,
        parsedChapters: cbseParsedChapters,
        totalTopics: cbseTotalTopics,
        topicsWithContent: cbseTopicsWithContent,
        topicsMissing: cbseTopicsMissing,
      },
      recommendedAction,
      message,
      suggestions,
      looksLikeSkillSubject,
      // Year resolved for this subject (from the explicit ?academicYear
      // param, else the subject's standards row). Clients render this
      // next to the recommendation so the admin knows which session the
      // bootstrap will land rows under.
      academicYear: yearContext,
      // Unused here but forwarded for clients that want to inspect the
      // subject's scrape-metadata without a separate round-trip.
      subjectMetadata,
    },
  });
}
