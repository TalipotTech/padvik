/**
 * Shared question insertion logic with provenance tracking.
 * Used by question paper scrapers to insert parsed questions into the DB.
 * Fuzzy-matches questions to existing curriculum hierarchy (board → standard → subject → chapter → topic).
 */
import { eq, and, ilike, sql } from "drizzle-orm";
import { db } from "@/db";
import { standards, subjects, chapters, topics } from "@/db/schema/curriculum";
import { questions, questionPapers } from "@/db/schema/questions";
import type { QuestionPaperParseResult } from "../ai/prompts/question-paper-parser";

/** Source context passed from the scraper for provenance tracking */
export interface QuestionSourceContext {
  pdfPath?: string;
  pdfUrl?: string;
  aiModel?: string;
  scrapeJobId?: number;
  boardCode?: string;
}

/** Result of inserting parsed questions */
export interface QuestionInsertResult {
  questionsInserted: number;
  questionsSkipped: number;
  topicsMapped: number;
  topicsUnmapped: number;
  questionPaperId: number;
}

/** Cache for topic lookups within a scrape run */
type TopicCache = Map<string, number>;

/**
 * Insert a parsed question paper and its questions into the database.
 */
export interface InsertOptions {
  /** When true, delete existing questions for this paper and re-insert (used by retry) */
  forceReinsert?: boolean;
}

export async function insertParsedQuestions(
  boardId: number,
  grade: number,
  parsed: QuestionPaperParseResult,
  existingPaperId?: number,
  log?: (message: string) => void,
  source?: QuestionSourceContext,
  options?: InsertOptions
): Promise<QuestionInsertResult> {
  const info = (msg: string) => log?.(msg);
  const topicCache: TopicCache = new Map();

  const result: QuestionInsertResult = {
    questionsInserted: 0,
    questionsSkipped: 0,
    topicsMapped: 0,
    topicsUnmapped: 0,
    questionPaperId: existingPaperId ?? 0,
  };

  // Find the standard
  const [standard] = await db
    .select()
    .from(standards)
    .where(and(eq(standards.boardId, boardId), eq(standards.grade, grade)))
    .limit(1);

  if (!standard) {
    info(`  Warning: Standard Class ${grade} not found for board ${boardId}. Skipping.`);
    return result;
  }

  // Create or reuse existing question paper record
  if (!existingPaperId) {
    // Check if a paper already exists for the same source URL (prevents duplicates on restart)
    if (source?.pdfUrl) {
      const [existingPaper] = await db
        .select({ id: questionPapers.id, questionCount: questionPapers.questionCount })
        .from(questionPapers)
        .where(eq(questionPapers.sourceUrl, source.pdfUrl))
        .limit(1);

      if (existingPaper && existingPaper.questionCount > 0) {
        if (options?.forceReinsert) {
          // Delete existing questions and re-insert
          info(`  Force re-insert: deleting ${existingPaper.questionCount} existing questions for paper #${existingPaper.id}`);
          await db
            .delete(questions)
            .where(eq(questions.sourcePaperId, existingPaper.id));
          await db
            .update(questionPapers)
            .set({ questionCount: 0, parsingStatus: "processing" })
            .where(eq(questionPapers.id, existingPaper.id));
          result.questionPaperId = existingPaper.id;
        } else {
          info(`  Paper already exists for ${source.pdfUrl} with ${existingPaper.questionCount} questions — skipping`);
          result.questionPaperId = existingPaper.id;
          result.questionsSkipped = parsed.questions.length;
          return result;
        }
      }

      if (existingPaper) {
        // Paper exists but has 0 questions (previous failed parse) — reuse it
        result.questionPaperId = existingPaper.id;
        info(`  Reusing existing paper #${existingPaper.id} (0 questions from previous attempt)`);
      }
    }

    if (result.questionPaperId === 0) {
      const paperMeta: Record<string, unknown> = {};
      if (source?.pdfPath) paperMeta.sourcePdf = source.pdfPath;
      if (source?.pdfUrl) paperMeta.sourceUrl = source.pdfUrl;
      if (source?.aiModel) paperMeta.aiModel = source.aiModel;
      if (source?.scrapeJobId) paperMeta.scrapeJobId = source.scrapeJobId;
      paperMeta.parsedAt = new Date().toISOString();

      const subjectId = await findSubjectId(
        standard.id,
        parsed.subjectName,
        parsed.subjectCode ?? undefined
      );

      const [paper] = await db
        .insert(questionPapers)
        .values({
          boardId,
          standardId: standard.id,
          subjectId,
          paperTitle:
            `${parsed.subjectName} ${parsed.paperType === "sqp" ? "Sample Question Paper" : "Question Bank"} Class ${grade}` +
            (parsed.paperYear ? ` (${parsed.paperYear})` : ""),
          paperYear: parsed.paperYear ?? new Date().getFullYear(),
          paperType: parsed.paperType ?? "sqp",
          totalMarks: parsed.totalMarks ?? null,
          durationMinutes: parsed.durationMinutes ?? null,
          sourceUrl: source?.pdfUrl ?? null,
          parsingStatus: "processing",
          parsedBy: source?.aiModel ?? "ai",
          metadata: paperMeta,
        })
        .returning({ id: questionPapers.id });

      result.questionPaperId = paper.id;
    }
  }

  // Check how many questions already exist for this paper (prevents duplication on restart)
  const existingQuestionCount = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(questions)
    .where(eq(questions.sourcePaperId, result.questionPaperId));

  const existingCount = existingQuestionCount[0]?.count ?? 0;
  if (existingCount > 0) {
    info(
      `  Paper #${result.questionPaperId} already has ${existingCount} questions in DB — skipping insert`
    );
    result.questionsSkipped = parsed.questions.length;
    return result;
  }

  info(
    `  Inserting ${parsed.questions.length} questions for ${parsed.subjectName} Class ${grade} (Paper #${result.questionPaperId})`
  );

  // Insert each question
  for (const q of parsed.questions) {
    try {
      const topicId = await findClosestTopic(
        boardId,
        standard.id,
        parsed.subjectName,
        q.chapterHint ?? null,
        q.topicHint ?? null,
        topicCache,
        info
      );

      if (topicId) {
        result.topicsMapped++;
      } else {
        result.topicsUnmapped++;
      }

      // Determine question type for our schema
      const questionType = mapQuestionType(q.questionType);

      // Build metadata
      const qMeta: Record<string, unknown> = {};
      if (q.hasInternalChoice) qMeta.hasInternalChoice = true;
      if (q.internalChoiceText) qMeta.internalChoiceText = q.internalChoiceText;
      if (q.subParts && q.subParts.length > 0) qMeta.subParts = q.subParts;
      if (source?.pdfUrl) qMeta.sourceUrl = source.pdfUrl;
      if (source?.aiModel) qMeta.aiModel = source.aiModel;
      if (source?.scrapeJobId) qMeta.scrapeJobId = source.scrapeJobId;
      qMeta.parsedAt = new Date().toISOString();

      if (!topicId) {
        // Cannot insert without topicId (FK constraint is NOT NULL)
        info(`  Skipped Q${q.questionNumber}: no topic match for "${q.chapterHint} / ${q.topicHint}"`);
        result.questionsSkipped++;
        continue;
      }

      // Detect language from question text
      const language = detectLanguage(q.questionText);

      await db.insert(questions).values({
        topicId,
        questionType,
        difficulty: q.difficulty ?? "medium",
        bloomLevel: q.bloomLevel ?? null,
        questionText: q.questionText,
        questionHtml: null,
        questionImages: [],
        options: q.options ?? null,
        correctAnswer: q.correctAnswer ?? null,
        solution: q.solution ?? null,
        solutionHtml: null,
        marks: String(q.marks),
        negativeMarks: "0.0",
        timeSeconds: null,
        sourceType: "scraped",
        sourceRef: source?.pdfUrl ?? null,
        sourceYear: parsed.paperYear ?? null,
        sourcePaperId: result.questionPaperId,
        language,
        isVerified: false,
        sectionLabel: q.sectionLabel ?? null,
        questionNumber: q.questionNumber,
        tags: [],
        metadata: qMeta,
      });

      result.questionsInserted++;
    } catch (err) {
      info(
        `  Failed Q${q.questionNumber}: ${err instanceof Error ? err.message : String(err)}`
      );
      result.questionsSkipped++;
    }
  }

  // Update question paper with final count and status
  await db
    .update(questionPapers)
    .set({
      parsingStatus: "completed",
      questionCount: result.questionsInserted,
    })
    .where(eq(questionPapers.id, result.questionPaperId));

  info(
    `  Done: ${result.questionsInserted} inserted, ${result.questionsSkipped} skipped, ${result.topicsMapped} topics mapped, ${result.topicsUnmapped} unmapped`
  );

  return result;
}

/**
 * Find the subject ID by name or code within a standard.
 */
async function findSubjectId(
  standardId: number,
  subjectName: string,
  subjectCode?: string
): Promise<number | null> {
  // Try exact code match first
  if (subjectCode) {
    const [byCode] = await db
      .select({ id: subjects.id })
      .from(subjects)
      .where(and(eq(subjects.standardId, standardId), eq(subjects.code, subjectCode)))
      .limit(1);
    if (byCode) return byCode.id;
  }

  // Try exact name match
  const [byName] = await db
    .select({ id: subjects.id })
    .from(subjects)
    .where(and(eq(subjects.standardId, standardId), ilike(subjects.name, subjectName)))
    .limit(1);
  if (byName) return byName.id;

  // Try partial name match
  const [byPartial] = await db
    .select({ id: subjects.id })
    .from(subjects)
    .where(
      and(eq(subjects.standardId, standardId), ilike(subjects.name, `%${subjectName}%`))
    )
    .limit(1);
  if (byPartial) return byPartial.id;

  return null;
}

/**
 * Fuzzy-match a question's chapter/topic hints against the curriculum hierarchy.
 * Returns a topic ID or null if no match found.
 * Results are cached in the topicCache for the duration of a scrape run.
 */
async function findClosestTopic(
  boardId: number,
  standardId: number,
  subjectName: string,
  chapterHint: string | null,
  topicHint: string | null,
  cache: TopicCache,
  _log?: (msg: string) => void
): Promise<number | null> {
  const cacheKey = `${standardId}:${subjectName}:${chapterHint ?? ""}:${topicHint ?? ""}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey)!;

  // Find subject
  const subjectId = await findSubjectId(standardId, subjectName);
  if (!subjectId) {
    cache.set(cacheKey, 0);
    return null;
  }

  // If we have a topic hint, try to find it directly
  if (topicHint) {
    const [topicMatch] = await db
      .select({ id: topics.id })
      .from(topics)
      .innerJoin(chapters, eq(topics.chapterId, chapters.id))
      .where(
        and(
          eq(chapters.subjectId, subjectId),
          ilike(topics.title, `%${topicHint}%`)
        )
      )
      .limit(1);

    if (topicMatch) {
      cache.set(cacheKey, topicMatch.id);
      return topicMatch.id;
    }
  }

  // If we have a chapter hint, find the chapter's first topic
  if (chapterHint) {
    const [chapterMatch] = await db
      .select({ id: chapters.id })
      .from(chapters)
      .where(
        and(eq(chapters.subjectId, subjectId), ilike(chapters.title, `%${chapterHint}%`))
      )
      .limit(1);

    if (chapterMatch) {
      const [firstTopic] = await db
        .select({ id: topics.id })
        .from(topics)
        .where(eq(topics.chapterId, chapterMatch.id))
        .orderBy(topics.sortOrder)
        .limit(1);

      if (firstTopic) {
        cache.set(cacheKey, firstTopic.id);
        return firstTopic.id;
      }
    }
  }

  // Fallback: use the first topic of the first chapter of this subject
  const [fallbackTopic] = await db
    .select({ id: topics.id })
    .from(topics)
    .innerJoin(chapters, eq(topics.chapterId, chapters.id))
    .where(eq(chapters.subjectId, subjectId))
    .orderBy(chapters.sortOrder, topics.sortOrder)
    .limit(1);

  if (fallbackTopic) {
    cache.set(cacheKey, fallbackTopic.id);
    return fallbackTopic.id;
  }

  cache.set(cacheKey, 0);
  return null;
}

/**
 * Map parser question types to our schema's question_type values.
 */
function mapQuestionType(
  parserType: string
): string {
  switch (parserType) {
    case "mcq":
      return "mcq";
    case "short_answer":
      return "short_answer";
    case "long_answer":
      return "long_answer";
    case "fill_blank":
      return "fill_blank";
    case "true_false":
      return "true_false";
    case "case_based":
    case "competency_based":
      return "long_answer"; // stored as long_answer with metadata.questionSubType
    case "assertion_reason":
      return "mcq"; // assertion-reason is MCQ-style
    case "map_based":
    case "diagram_based":
      return "short_answer";
    default:
      return "short_answer";
  }
}

/**
 * Detect the primary language of a text based on Unicode script ranges.
 * Returns ISO 639-1 language code.
 */
function detectLanguage(text: string): string {
  if (!text) return "en";

  // Count characters in each script range
  const scripts: Record<string, number> = {
    hi: 0, // Devanagari (Hindi, Sanskrit, Marathi)
    ta: 0, // Tamil
    ml: 0, // Malayalam
    te: 0, // Telugu
    kn: 0, // Kannada
    bn: 0, // Bengali
    gu: 0, // Gujarati
    pa: 0, // Gurmukhi (Punjabi)
    or: 0, // Odia
    en: 0, // Latin
  };

  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0x0900 && code <= 0x097F) scripts.hi++;
    else if (code >= 0x0B80 && code <= 0x0BFF) scripts.ta++;
    else if (code >= 0x0D00 && code <= 0x0D7F) scripts.ml++;
    else if (code >= 0x0C00 && code <= 0x0C7F) scripts.te++;
    else if (code >= 0x0C80 && code <= 0x0CFF) scripts.kn++;
    else if (code >= 0x0980 && code <= 0x09FF) scripts.bn++;
    else if (code >= 0x0A80 && code <= 0x0AFF) scripts.gu++;
    else if (code >= 0x0A00 && code <= 0x0A7F) scripts.pa++;
    else if (code >= 0x0B00 && code <= 0x0B7F) scripts.or++;
    else if ((code >= 0x0041 && code <= 0x007A)) scripts.en++;
  }

  // Find script with most characters (excluding English for bilingual papers)
  let maxLang = "en";
  let maxCount = 0;
  for (const [lang, count] of Object.entries(scripts)) {
    if (lang === "en") continue; // Check non-English first
    if (count > maxCount) {
      maxCount = count;
      maxLang = lang;
    }
  }

  // If non-English script has significant presence (>30% of identified chars), use it
  const totalIdentified = Object.values(scripts).reduce((a, b) => a + b, 0);
  if (totalIdentified > 0 && maxCount > 0 && maxCount / totalIdentified > 0.3) {
    return maxLang;
  }

  return "en";
}
