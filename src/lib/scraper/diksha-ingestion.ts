/**
 * DIKSHA Content Ingestion Pipeline
 *
 * For a given board and grade range:
 * 1. Query DIKSHA for textbooks via the DikshaClient
 * 2. Get TOC (table of contents) for each textbook
 * 3. Compare with existing chapters/topics in our DB — INSERT new, UPDATE existing
 * 4. Search for linked content per topic:
 *    - ExplanationContent → content_items
 *    - PracticeQuestionSet → questions
 *    - LessonPlan → content_items
 * 5. Download PDFs to local storage (→ S3 in production)
 * 6. Queue for existing parser
 *
 * All DIKSHA content gets source_type = 'diksha'.
 * Dedup: check source_url before inserting any content_item.
 */
import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import { boards, standards, subjects, chapters, topics } from "@/db/schema/curriculum";
import { contentItems } from "@/db/schema/content";
import { scrapeJobs, contentPipelineLogs } from "@/db/schema/system";
import { computeQualityScore } from "../ai/quality-scorer";
import {
  DikshaClient,
  dikshaBoardToOurCode,
  dikshaGradeToNumber,
  numberToDikshaGrade,
  dikshaContentTypeToOurs,
  dikshaMediaType,
  ourCodeToDikshaBoard,
  type DikshaContent,
} from "./diksha-client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DikshaIngestOptions {
  boardCode: string;
  gradeStart: number;
  gradeEnd: number;
  subjectFilter?: string;
  medium?: string;
  jobId?: number;
  /** Skip downloading artifacts (dry run for curriculum mapping only) */
  skipArtifacts?: boolean;
}

export interface IngestResult {
  textbooksFound: number;
  chaptersInserted: number;
  chaptersUpdated: number;
  topicsInserted: number;
  topicsUpdated: number;
  contentItemsInserted: number;
  contentItemsSkipped: number;
  artifactsDownloaded: number;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Main ingestion pipeline
// ---------------------------------------------------------------------------

export async function runDikshaIngestion(options: DikshaIngestOptions): Promise<IngestResult> {
  const client = new DikshaClient("[DIKSHA Ingest]");
  const log = (msg: string) => console.log(`[DIKSHA Ingest] ${msg}`);

  const result: IngestResult = {
    textbooksFound: 0,
    chaptersInserted: 0,
    chaptersUpdated: 0,
    topicsInserted: 0,
    topicsUpdated: 0,
    contentItemsInserted: 0,
    contentItemsSkipped: 0,
    artifactsDownloaded: 0,
    errors: [],
  };

  const { boardCode, gradeStart, gradeEnd, subjectFilter, medium, jobId } = options;

  try {
    // Resolve our board in DB
    const [board] = await db
      .select()
      .from(boards)
      .where(eq(boards.code, boardCode))
      .limit(1);

    if (!board) {
      throw new Error(`Board '${boardCode}' not found in database. Run seed first.`);
    }

    if (jobId) {
      await updateJob(jobId, { status: "running" });
    }

    log(`Starting DIKSHA ingestion for ${boardCode}, Classes ${gradeStart}-${gradeEnd}`);

    // Step 1: Search DIKSHA for textbooks
    log("Searching DIKSHA for textbooks...");
    const textbooks = await client.searchTextbooks(
      boardCode,
      gradeStart,
      gradeEnd,
      subjectFilter,
      medium
    );

    result.textbooksFound = textbooks.length;
    log(`Found ${textbooks.length} textbooks on DIKSHA`);

    if (jobId) {
      await updateJob(jobId, { itemsFound: textbooks.length });
    }

    if (textbooks.length === 0) {
      log("No textbooks found. Trying direct content search as fallback...");
      // Some boards may not have TextBook entries but have content directly
      await ingestDirectContent(client, board.id, boardCode, gradeStart, gradeEnd, subjectFilter, medium, result, log, jobId);
    } else {
      // Step 2: Process each textbook
      for (let i = 0; i < textbooks.length; i++) {
        const textbook = textbooks[i];
        log(`\n[${i + 1}/${textbooks.length}] Processing: ${textbook.name}`);

        try {
          await processTextbook(client, textbook, board.id, boardCode, options, result, log);
        } catch (err) {
          const errMsg = `Failed to process textbook '${textbook.name}': ${err instanceof Error ? err.message : String(err)}`;
          log(`  ERROR: ${errMsg}`);
          result.errors.push(errMsg);
        }

        if (jobId) {
          await updateJob(jobId, { itemsProcessed: i + 1 });
        }
      }
    }

    // Summary
    log(`\n=== DIKSHA Ingestion Summary ===`);
    log(`Textbooks found: ${result.textbooksFound}`);
    log(`Chapters: ${result.chaptersInserted} new, ${result.chaptersUpdated} updated`);
    log(`Topics: ${result.topicsInserted} new, ${result.topicsUpdated} updated`);
    log(`Content items: ${result.contentItemsInserted} new, ${result.contentItemsSkipped} duplicates skipped`);
    log(`Artifacts downloaded: ${result.artifactsDownloaded}`);
    if (result.errors.length > 0) {
      log(`Errors: ${result.errors.length}`);
    }

    if (jobId) {
      await updateJob(jobId, { status: "completed" });
      await updateJobMetadata(jobId, { ingestResult: result });
    }

    await logPipeline("diksha_ingest_complete", jobId ?? 0, "completed", {
      boardCode,
      gradeStart,
      gradeEnd,
      ...result,
    });

    return result;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    log(`FATAL: ${errMsg}`);

    if (jobId) {
      await updateJob(jobId, { status: "failed", errorLog: errMsg });
    }

    throw err;
  }
}

// ---------------------------------------------------------------------------
// Process a single textbook
// ---------------------------------------------------------------------------

async function processTextbook(
  client: DikshaClient,
  textbook: DikshaContent,
  boardId: number,
  boardCode: string,
  options: DikshaIngestOptions,
  result: IngestResult,
  log: (msg: string) => void
): Promise<void> {
  // Get the full hierarchy (TOC)
  log(`  Fetching TOC for: ${textbook.identifier}`);
  const toc = await client.getTextbookTOC(textbook.identifier);

  // Determine grade from textbook metadata
  const gradeStr = textbook.gradeLevel?.[0] ?? toc.gradeLevel?.[0] ?? "";
  const grade = dikshaGradeToNumber(gradeStr);
  if (grade === 0) {
    log(`  Could not determine grade for textbook, skipping`);
    return;
  }

  // Determine subject
  const subjectName = textbook.subject?.[0] ?? toc.subject?.[0] ?? textbook.name;
  const medium = textbook.medium?.[0] ?? "English";
  log(`  Grade: ${grade}, Subject: ${subjectName}, Medium: ${medium}`);

  // Ensure standard exists
  const standard = await findOrCreateStandard(boardId, grade);
  if (!standard) {
    log(`  Could not find/create standard for Class ${grade}`);
    return;
  }

  // Ensure subject exists
  const subjectCode = normalizeSubjectCode(subjectName);
  const subject = await findOrCreateSubject(standard.id, subjectCode, subjectName, {
    dikshaTextbookId: textbook.identifier,
    dikshaMedium: medium,
    dikshaFramework: textbook.framework,
  });

  // Walk the TOC hierarchy and insert chapters/topics
  const children = toc.children ?? [];
  log(`  TOC has ${children.length} top-level entries`);

  for (let chIdx = 0; chIdx < children.length; chIdx++) {
    const chapterNode = children[chIdx];
    const chapterTitle = chapterNode.name ?? `Chapter ${chIdx + 1}`;

    // Insert or update chapter
    const chapter = await upsertChapter(
      subject.id,
      chIdx + 1,
      chapterTitle,
      chapterNode.description ?? null,
      {
        dikshaId: chapterNode.identifier,
        dikshaContentType: chapterNode.contentType,
      }
    );

    if (chapter.isNew) result.chaptersInserted++;
    else result.chaptersUpdated++;

    // Process topics (sub-nodes in the TOC)
    const topicNodes = chapterNode.children ?? [];
    for (let tIdx = 0; tIdx < topicNodes.length; tIdx++) {
      const topicNode = topicNodes[tIdx];
      const topicTitle = topicNode.name ?? `Topic ${tIdx + 1}`;

      const topic = await upsertTopic(
        chapter.id,
        topicTitle,
        tIdx + 1,
        topicNode.description ?? null,
        topicNode.learningOutcome ?? [],
        {
          dikshaId: topicNode.identifier,
          dikshaTopics: topicNode.topic,
        }
      );

      if (topic.isNew) result.topicsInserted++;
      else result.topicsUpdated++;

      // Search for linked content for this topic
      if (!options.skipArtifacts) {
        await ingestTopicContent(
          client,
          boardCode,
          grade,
          subjectName,
          topicTitle,
          topic.id,
          medium === "English" ? "en" : detectLanguageFromMedium(medium),
          result,
          log
        );
      }
    }

    // If chapter has no sub-topics, treat the chapter itself as a topic
    if (topicNodes.length === 0) {
      const topic = await upsertTopic(
        chapter.id,
        chapterTitle,
        1,
        chapterNode.description ?? null,
        chapterNode.learningOutcome ?? [],
        { dikshaId: chapterNode.identifier }
      );

      if (topic.isNew) result.topicsInserted++;
      else result.topicsUpdated++;

      if (!options.skipArtifacts) {
        await ingestTopicContent(
          client,
          boardCode,
          grade,
          subjectName,
          chapterTitle,
          topic.id,
          medium === "English" ? "en" : detectLanguageFromMedium(medium),
          result,
          log
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Direct content search (fallback when no textbook TOC available)
// ---------------------------------------------------------------------------

async function ingestDirectContent(
  client: DikshaClient,
  boardId: number,
  boardCode: string,
  gradeStart: number,
  gradeEnd: number,
  subjectFilter: string | undefined,
  medium: string | undefined,
  result: IngestResult,
  log: (msg: string) => void,
  jobId?: number
): Promise<void> {
  const dikshaBoard = ourCodeToDikshaBoard(boardCode);

  for (let grade = gradeStart; grade <= gradeEnd; grade++) {
    log(`  Searching direct content for Class ${grade}...`);

    const gradeLevels = [numberToDikshaGrade(grade)];
    const content = await client.searchAll(
      {
        board: [dikshaBoard],
        gradeLevel: gradeLevels,
        contentType: [
          "ExplanationContent",
          "PracticeQuestionSet",
          "LessonPlan",
          "Resource",
        ],
        ...(subjectFilter ? { subject: [subjectFilter] } : {}),
        ...(medium ? { medium: [medium] } : {}),
      },
      200
    );

    log(`  Found ${content.length} content items for Class ${grade}`);
    result.textbooksFound += content.length;

    // Group by subject
    const bySubject = new Map<string, DikshaContent[]>();
    for (const item of content) {
      const subj = item.subject?.[0] ?? "General";
      const list = bySubject.get(subj) ?? [];
      list.push(item);
      bySubject.set(subj, list);
    }

    const standard = await findOrCreateStandard(boardId, grade);
    if (!standard) continue;

    for (const [subjectName, items] of bySubject) {
      const subjectCode = normalizeSubjectCode(subjectName);
      const subject = await findOrCreateSubject(standard.id, subjectCode, subjectName, {
        source: "diksha_direct",
      });

      // Create a default chapter for ungrouped content
      const chapter = await upsertChapter(
        subject.id,
        1,
        `${subjectName} — DIKSHA Content`,
        `Content imported from DIKSHA for ${subjectName}`,
        { source: "diksha_direct" }
      );
      if (chapter.isNew) result.chaptersInserted++;

      const topic = await upsertTopic(
        chapter.id,
        `${subjectName} Resources`,
        1,
        null,
        [],
        { source: "diksha_direct" }
      );
      if (topic.isNew) result.topicsInserted++;

      const lang = items[0]?.medium?.[0] === "English" ? "en" : detectLanguageFromMedium(items[0]?.medium?.[0] ?? "English");

      for (const item of items) {
        const inserted = await insertContentItem(
          topic.id,
          item,
          lang
        );
        if (inserted) result.contentItemsInserted++;
        else result.contentItemsSkipped++;
      }
    }

    if (jobId) {
      await updateJob(jobId, { itemsProcessed: grade - gradeStart + 1 });
    }
  }
}

// ---------------------------------------------------------------------------
// Topic-level content ingestion
// ---------------------------------------------------------------------------

async function ingestTopicContent(
  client: DikshaClient,
  boardCode: string,
  grade: number,
  subjectName: string,
  topicTitle: string,
  topicId: number,
  language: string,
  result: IngestResult,
  log: (msg: string) => void
): Promise<void> {
  try {
    const content = await client.searchTopicContent(
      boardCode,
      numberToDikshaGrade(grade),
      subjectName,
      topicTitle
    );

    if (content.length === 0) return;

    for (const item of content) {
      // Download PDF artifacts if available
      if (item.artifactUrl && dikshaMediaType(item.mimeType) === "pdf") {
        try {
          const downloaded = await client.downloadArtifact(
            item.artifactUrl,
            boardCode,
            grade,
            `${item.identifier}.pdf`
          );
          if (downloaded) {
            result.artifactsDownloaded++;
          }
        } catch {
          // Non-critical — continue without the artifact
        }
      }

      const inserted = await insertContentItem(topicId, item, language);
      if (inserted) result.contentItemsInserted++;
      else result.contentItemsSkipped++;
    }
  } catch (err) {
    // Topic content search failures are non-critical
    const errMsg = `Content search failed for topic '${topicTitle}': ${err instanceof Error ? err.message : String(err)}`;
    result.errors.push(errMsg);
  }
}

// ---------------------------------------------------------------------------
// DB upsert helpers
// ---------------------------------------------------------------------------

async function findOrCreateStandard(
  boardId: number,
  grade: number
): Promise<{ id: number } | null> {
  const academicYear = "2025-26";

  const [existing] = await db
    .select({ id: standards.id })
    .from(standards)
    .where(
      and(
        eq(standards.boardId, boardId),
        eq(standards.grade, grade),
        eq(standards.academicYear, academicYear)
      )
    )
    .limit(1);

  if (existing) return existing;

  // Create the standard
  try {
    const [created] = await db
      .insert(standards)
      .values({
        boardId,
        grade,
        academicYear,
        isActive: true,
        metadata: { source: "diksha_ingest" },
      })
      .returning({ id: standards.id });

    return created ?? null;
  } catch {
    // Unique constraint conflict — re-fetch
    const [refetched] = await db
      .select({ id: standards.id })
      .from(standards)
      .where(
        and(
          eq(standards.boardId, boardId),
          eq(standards.grade, grade),
          eq(standards.academicYear, academicYear)
        )
      )
      .limit(1);

    return refetched ?? null;
  }
}

async function findOrCreateSubject(
  standardId: number,
  code: string,
  name: string,
  metadata: Record<string, unknown>
): Promise<{ id: number }> {
  const [existing] = await db
    .select({ id: subjects.id })
    .from(subjects)
    .where(
      and(
        eq(subjects.standardId, standardId),
        eq(subjects.code, code)
      )
    )
    .limit(1);

  if (existing) {
    // Update metadata with DIKSHA info
    await db
      .update(subjects)
      .set({
        metadata: { ...metadata, updatedFromDiksha: new Date().toISOString() },
      })
      .where(eq(subjects.id, existing.id));

    return existing;
  }

  const [created] = await db
    .insert(subjects)
    .values({
      standardId,
      code,
      name,
      subjectType: "theory",
      isElective: false,
      metadata: { ...metadata, source: "diksha" },
    })
    .returning({ id: subjects.id });

  return created;
}

async function upsertChapter(
  subjectId: number,
  chapterNumber: number,
  title: string,
  description: string | null,
  metadata: Record<string, unknown>
): Promise<{ id: number; isNew: boolean }> {
  const [existing] = await db
    .select({ id: chapters.id, description: chapters.description })
    .from(chapters)
    .where(
      and(
        eq(chapters.subjectId, subjectId),
        eq(chapters.chapterNumber, chapterNumber)
      )
    )
    .limit(1);

  if (existing) {
    // Update with richer metadata from DIKSHA if we have new info
    const updates: Record<string, unknown> = {
      metadata: { ...metadata, updatedFromDiksha: new Date().toISOString() },
    };
    if (description && !existing.description) {
      updates.description = description;
    }

    await db
      .update(chapters)
      .set(updates)
      .where(eq(chapters.id, existing.id));

    return { id: existing.id, isNew: false };
  }

  const [created] = await db
    .insert(chapters)
    .values({
      subjectId,
      chapterNumber,
      title,
      description,
      sortOrder: chapterNumber,
      metadata: { ...metadata, source: "diksha" },
    })
    .returning({ id: chapters.id });

  return { id: created.id, isNew: true };
}

async function upsertTopic(
  chapterId: number,
  title: string,
  sortOrder: number,
  description: string | null,
  learningOutcomes: string[],
  metadata: Record<string, unknown>
): Promise<{ id: number; isNew: boolean }> {
  // Find by title match within the same chapter
  const [existing] = await db
    .select({ id: topics.id, description: topics.description })
    .from(topics)
    .where(
      and(
        eq(topics.chapterId, chapterId),
        eq(topics.title, title)
      )
    )
    .limit(1);

  if (existing) {
    const updates: Record<string, unknown> = {
      metadata: { ...metadata, updatedFromDiksha: new Date().toISOString() },
    };
    if (description && !existing.description) {
      updates.description = description;
    }
    if (learningOutcomes.length > 0) {
      updates.learningObjectives = learningOutcomes;
    }

    await db
      .update(topics)
      .set(updates)
      .where(eq(topics.id, existing.id));

    return { id: existing.id, isNew: false };
  }

  const [created] = await db
    .insert(topics)
    .values({
      chapterId,
      title,
      description,
      sortOrder,
      learningObjectives: learningOutcomes.length > 0 ? learningOutcomes : [],
      metadata: { ...metadata, source: "diksha" },
    })
    .returning({ id: topics.id });

  return { id: created.id, isNew: true };
}

/**
 * Insert a DIKSHA content item, skipping if source_url already exists (dedup).
 * Returns true if inserted, false if skipped.
 */
async function insertContentItem(
  topicId: number,
  item: DikshaContent,
  language: string
): Promise<boolean> {
  // Build a stable source URL for dedup
  const sourceUrl = item.artifactUrl
    ?? item.downloadUrl
    ?? item.previewUrl
    ?? `diksha://${item.identifier}`;

  // Dedup check
  const [existing] = await db
    .select({ id: contentItems.id })
    .from(contentItems)
    .where(eq(contentItems.sourceUrl, sourceUrl))
    .limit(1);

  if (existing) return false;

  const ourType = dikshaContentTypeToOurs(item.contentType ?? "Resource");
  const media = dikshaMediaType(item.mimeType);

  // Build body based on what we have
  let body = item.description ?? item.name ?? "";
  if (media === "video" && (item.streamingUrl || item.previewUrl)) {
    body += `\n\n[Video Link](${item.streamingUrl ?? item.previewUrl})`;
  }
  if (item.artifactUrl && media === "pdf") {
    body += `\n\n[PDF Download](${item.artifactUrl})`;
  }

  // Map DIKSHA content types to our content_type values
  const contentType = mapToContentType(ourType, media);

  await db.insert(contentItems).values({
    topicId,
    contentType,
    title: item.name ?? "Untitled",
    body,
    bodyFormat: "markdown",
    sourceType: "diksha",
    sourceUrl,
    language,
    qualityScore: computeQualityScore(body).toFixed(2),
    reviewStatus: "pending",
    isPublished: false,
    metadata: {
      dikshaId: item.identifier,
      dikshaContentType: item.contentType,
      dikshaMimeType: item.mimeType,
      dikshaResourceType: item.resourceType,
      dikshaTopics: item.topic,
      dikshaLearningOutcomes: item.learningOutcome,
      importedAt: new Date().toISOString(),
    },
  });

  return true;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeSubjectCode(name: string): string {
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 50);
}

function mapToContentType(
  padvikType: string,
  media: string
): string {
  if (media === "video") return "video_link";
  if (media === "interactive") return "interactive";
  switch (padvikType) {
    case "explanation": return "explanation";
    case "lesson_plan": return "lesson_plan";
    case "question_set": return "practice_set";
    case "textbook": return "note";
    default: return "note";
  }
}

function detectLanguageFromMedium(medium: string): string {
  const mediumLower = medium.toLowerCase();
  const mediumMap: Record<string, string> = {
    english: "en",
    hindi: "hi",
    malayalam: "ml",
    tamil: "ta",
    telugu: "te",
    kannada: "kn",
    marathi: "mr",
    gujarati: "gu",
    bengali: "bn",
    punjabi: "pa",
    urdu: "ur",
    assamese: "as",
    odia: "or",
  };
  return mediumMap[mediumLower] ?? "en";
}

// ---------------------------------------------------------------------------
// Job / logging helpers
// ---------------------------------------------------------------------------

async function updateJob(
  jobId: number,
  updates: Partial<{
    status: string;
    itemsFound: number;
    itemsProcessed: number;
    errorLog: string;
  }>
): Promise<void> {
  const values: Record<string, unknown> = {};
  if (updates.status) values.status = updates.status;
  if (updates.itemsFound !== undefined) values.itemsFound = updates.itemsFound;
  if (updates.itemsProcessed !== undefined) values.itemsProcessed = updates.itemsProcessed;
  if (updates.errorLog) values.errorLog = updates.errorLog;
  if (updates.status === "running") values.startedAt = new Date();
  if (updates.status === "completed" || updates.status === "failed") {
    values.completedAt = new Date();
  }

  await db
    .update(scrapeJobs)
    .set(values)
    .where(eq(scrapeJobs.id, jobId));
}

async function updateJobMetadata(
  jobId: number,
  newMeta: Record<string, unknown>
): Promise<void> {
  try {
    const [job] = await db
      .select({ metadata: scrapeJobs.metadata })
      .from(scrapeJobs)
      .where(eq(scrapeJobs.id, jobId))
      .limit(1);

    const existing = (job?.metadata as Record<string, unknown>) ?? {};
    await db
      .update(scrapeJobs)
      .set({ metadata: { ...existing, ...newMeta } })
      .where(eq(scrapeJobs.id, jobId));
  } catch {
    // Non-critical
  }
}

async function logPipeline(
  stage: string,
  entityId: number,
  status: string,
  data: Record<string, unknown>,
  processingTimeMs?: number
): Promise<void> {
  try {
    await db.insert(contentPipelineLogs).values({
      pipelineStage: stage,
      entityType: "scrape_job",
      entityId,
      status,
      outputData: data,
      processingTimeMs: processingTimeMs ?? null,
      aiProvider: "diksha_api",
    });
  } catch {
    // Non-critical
  }
}
