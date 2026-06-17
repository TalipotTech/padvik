import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { eq, asc } from "drizzle-orm";
import { subjects, chapters, topics, standards, boards } from "@/db/schema/curriculum";
import { readExtractedText } from "@/lib/scraper/pdf-storage";

/**
 * GET /api/admin/curriculum-explorer/[subjectId]/verify
 *
 * Returns the raw extracted text from the source PDF alongside
 * the structured parsed content for side-by-side comparison.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ subjectId: string }> }
) {
  const session = await auth();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Admin access required" } },
      { status: 403 }
    );
  }

  const { subjectId: subjectIdStr } = await params;
  const subjectId = parseInt(subjectIdStr, 10);
  if (isNaN(subjectId)) {
    return NextResponse.json(
      { success: false, error: { code: "INVALID_ID", message: "Invalid subject ID" } },
      { status: 400 }
    );
  }

  try {
    // Fetch subject with standard and board info. academicYear is surfaced so
    // the syllabus-viewer info bar can disambiguate two "Mathematics" subjects
    // that only differ by session (e.g. CBSE Class 10 exists for 2025-26 and
    // 2026-27 simultaneously during the rollover window).
    const [subject] = await db
      .select({
        id: subjects.id,
        name: subjects.name,
        code: subjects.code,
        maxMarks: subjects.maxMarks,
        metadata: subjects.metadata,
        grade: standards.grade,
        stream: standards.stream,
        academicYear: standards.academicYear,
        boardCode: boards.code,
        boardName: boards.name,
      })
      .from(subjects)
      .innerJoin(standards, eq(subjects.standardId, standards.id))
      .innerJoin(boards, eq(standards.boardId, boards.id))
      .where(eq(subjects.id, subjectId))
      .limit(1);

    if (!subject) {
      return NextResponse.json(
        { success: false, error: { code: "NOT_FOUND", message: "Subject not found" } },
        { status: 404 }
      );
    }

    // Fetch chapters with topics
    const chapterRows = await db
      .select()
      .from(chapters)
      .where(eq(chapters.subjectId, subjectId))
      .orderBy(asc(chapters.chapterNumber));

    const parsedContent = [];
    for (const ch of chapterRows) {
      const topicRows = await db
        .select()
        .from(topics)
        .where(eq(topics.chapterId, ch.id))
        .orderBy(asc(topics.sortOrder));

      parsedContent.push({
        ...ch,
        topics: topicRows,
      });
    }

    // Read the raw extracted text from local storage. Only the CBSE legacy
    // scraper writes `sourceText` at the subject level — NCERT content is
    // downloaded per-chapter, so rawText stays null and the right-hand
    // "Raw Syllabus Text" panel shows its empty state (the TOC sidebar still
    // works fine off parsedContent).
    const meta = (subject.metadata as Record<string, unknown>) ?? {};
    const textPath = meta.sourceText as string | undefined;
    const pdfPath = meta.sourcePdf as string | undefined;
    const sourceUrl = meta.sourceUrl as string | undefined;
    const sourceType = (meta.source as string) ?? (pdfPath ? "scraped" : null);

    let rawText: string | null = null;
    if (textPath) {
      rawText = await readExtractedText(textPath);
    }

    return NextResponse.json({
      success: true,
      data: {
        subject: {
          id: subject.id,
          name: subject.name,
          code: subject.code,
          maxMarks: subject.maxMarks,
          grade: subject.grade,
          stream: subject.stream,
          academicYear: subject.academicYear,
          boardCode: subject.boardCode,
          boardName: subject.boardName,
          reviewStatus: (meta.reviewStatus as string) ?? "pending",
          aiModel: meta.aiModel ?? null,
          parsedAt: meta.parsedAt ?? null,
          sourcePdf: pdfPath ?? null,
          sourceUrl: sourceUrl ?? null,
          sourceType,
          scrapeJobId: meta.scrapeJobId ?? null,
        },
        parsedContent,
        rawText,
        hasRawText: rawText !== null,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: { code: "QUERY_ERROR", message } },
      { status: 500 }
    );
  }
}
