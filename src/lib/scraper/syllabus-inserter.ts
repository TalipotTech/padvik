/**
 * Shared syllabus insertion logic with provenance tracking.
 * Used by all board scrapers to insert parsed syllabus data into the DB hierarchy.
 * Stores source PDF path, AI model, and scrape job ID on every entity.
 */
import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import { standards, subjects, chapters, topics } from "@/db/schema/curriculum";
import type { SyllabusParseResult } from "../ai/prompts/syllabus-parser";

/** Source context passed from the scraper for provenance tracking */
export interface SourceContext {
  /** Local path to the stored PDF (e.g., "data/pdfs/CBSE/10/Arabic.pdf") */
  pdfPath?: string;
  /** Local path to the extracted text file */
  textPath?: string;
  /** Original remote URL of the PDF */
  pdfUrl?: string;
  /** AI model used for parsing */
  aiModel?: string;
  /** Scrape job ID that created this content */
  scrapeJobId?: number;
  /** Board code */
  boardCode?: string;
}

export async function insertParsedSyllabus(
  boardId: number,
  grade: number,
  parsed: SyllabusParseResult,
  log?: (message: string) => void,
  source?: SourceContext
): Promise<{ chaptersInserted: number; topicsInserted: number; subjectId: number }> {
  const info = (msg: string) => log?.(msg);
  const academicYear = parsed.academicYear ?? "2025-26";
  const stream = parsed.stream ?? null;

  // Find or verify the standard exists
  const [standard] = await db
    .select()
    .from(standards)
    .where(
      and(
        eq(standards.boardId, boardId),
        eq(standards.grade, grade),
        eq(standards.academicYear, academicYear),
        stream ? eq(standards.stream, stream) : undefined
      )
    )
    .limit(1);

  if (!standard) {
    info(`  Warning: Standard Class ${grade} not found for board ${boardId}. Skipping insert.`);
    return { chaptersInserted: 0, topicsInserted: 0, subjectId: 0 };
  }

  // Build provenance metadata for subject
  const subjectMetadata: Record<string, unknown> = {};
  if (source) {
    if (source.pdfPath) subjectMetadata.sourcePdf = source.pdfPath;
    if (source.textPath) subjectMetadata.sourceText = source.textPath;
    if (source.pdfUrl) subjectMetadata.sourceUrl = source.pdfUrl;
    if (source.aiModel) subjectMetadata.aiModel = source.aiModel;
    if (source.scrapeJobId) subjectMetadata.scrapeJobId = source.scrapeJobId;
    if (source.boardCode) subjectMetadata.boardCode = source.boardCode;
    subjectMetadata.parsedAt = new Date().toISOString();
    subjectMetadata.reviewStatus = "pending"; // Pending admin verification
  }

  // Upsert subject
  const [subject] = await db
    .insert(subjects)
    .values({
      standardId: standard.id,
      code: parsed.subjectCode,
      name: parsed.subjectName,
      maxMarks: parsed.totalMarks ?? null,
      subjectType: "theory",
      isElective: false,
      metadata: Object.keys(subjectMetadata).length > 0 ? subjectMetadata : {},
    })
    .onConflictDoNothing()
    .returning({ id: subjects.id });

  // If conflict, fetch existing and update metadata
  let subjectId: number;
  if (subject) {
    subjectId = subject.id;
  } else {
    const [existing] = await db
      .select()
      .from(subjects)
      .where(
        and(eq(subjects.standardId, standard.id), eq(subjects.code, parsed.subjectCode))
      )
      .limit(1);
    if (!existing) throw new Error("Subject insert/lookup failed");
    subjectId = existing.id;

    // Update metadata on existing subject with latest source info
    if (Object.keys(subjectMetadata).length > 0) {
      const existingMeta = (existing.metadata as Record<string, unknown>) ?? {};
      await db
        .update(subjects)
        .set({ metadata: { ...existingMeta, ...subjectMetadata } })
        .where(eq(subjects.id, subjectId));
    }
  }

  // Insert chapters and topics
  let chaptersInserted = 0;
  let topicsInserted = 0;

  // Chapter-level provenance
  const chapterMeta: Record<string, unknown> = {};
  if (source?.pdfPath) chapterMeta.sourcePdf = source.pdfPath;
  if (source?.pdfUrl) chapterMeta.sourceUrl = source.pdfUrl;

  for (const ch of parsed.chapters) {
    const [chapter] = await db
      .insert(chapters)
      .values({
        subjectId,
        chapterNumber: ch.chapterNumber,
        title: ch.title,
        description: ch.description ?? null,
        estimatedHours: ch.estimatedHours?.toString() ?? null,
        weightagePct: ch.weightagePct?.toString() ?? null,
        sortOrder: ch.chapterNumber,
        metadata: Object.keys(chapterMeta).length > 0 ? chapterMeta : {},
      })
      .onConflictDoNothing()
      .returning({ id: chapters.id });

    if (!chapter) {
      // Chapter already exists — skip topics (idempotent)
      continue;
    }

    chaptersInserted++;

    // Insert topics for this chapter
    if (ch.topics.length > 0) {
      await db.insert(topics).values(
        ch.topics.map((t) => ({
          chapterId: chapter.id,
          title: t.title,
          description: t.description ?? null,
          sortOrder: t.sortOrder,
        }))
      );
      topicsInserted += ch.topics.length;
    }
  }

  info(
    `  Inserted: ${chaptersInserted} chapters, ${topicsInserted} topics for ${parsed.subjectName} Class ${grade}`
  );

  return { chaptersInserted, topicsInserted, subjectId };
}
