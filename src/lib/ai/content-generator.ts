/**
 * AI Content Gap Filler
 *
 * Finds topics that lack sufficient content and generates notes, flashcards,
 * and MCQs using the AI provider. Uses Claude Sonnet for quality content
 * (notes, MCQs) and Claude Haiku for bulk work (flashcards).
 *
 * All generated content is stored with source_type='ai_generated' and
 * review_status='pending' for admin review before publishing.
 */
import { eq, and, sql, asc, desc, inArray } from "drizzle-orm";
import { db } from "@/db";
import { boards, standards, subjects, chapters, topics } from "@/db/schema/curriculum";
import { contentItems } from "@/db/schema/content";
import { questions } from "@/db/schema/questions";
import { contentPipelineLogs } from "@/db/schema/system";
import { aiChat, AI_MODELS, type AICallOptions, type AILogContext } from "./provider";
import { computeQualityScore } from "./quality-scorer";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A topic that has insufficient published content */
export interface ContentGap {
  topicId: number;
  topicTitle: string;
  chapterTitle: string;
  subjectName: string;
  subjectCode: string;
  grade: number;
  boardCode: string;
  boardName: string;
  publishedContentCount: number;
  questionCount: number;
  /** Priority score: higher = fill first. Based on board, grade, subject. */
  priority: number;
}

export interface GenerateOptions {
  /** Generate study notes for the topic */
  notes?: boolean;
  /** Generate flashcards for the topic */
  flashcards?: boolean;
  /** Generate MCQs for the topic */
  mcqs?: boolean;
  /** Number of MCQs to generate (default: 5) */
  mcqCount?: number;
  /** Number of flashcards to generate (default: 10) */
  flashcardCount?: number;
  /** Language for generation (default: 'en') */
  language?: string;
}

export interface GenerateResult {
  topicId: number;
  notesGenerated: boolean;
  flashcardsGenerated: number;
  mcqsGenerated: number;
  totalTokens: number;
  totalCostUsd: number;
  errors: string[];
}

export interface BulkGenerateOptions {
  /** Max topics to process in one batch */
  batchSize?: number;
  /** Content types to generate */
  notes?: boolean;
  flashcards?: boolean;
  mcqs?: boolean;
  mcqCount?: number;
  flashcardCount?: number;
  /** Filter by board codes */
  boardCodes?: string[];
  /** Filter by grades */
  grades?: number[];
  /** Filter by subjects */
  subjects?: string[];
  language?: string;
  /** If true, only estimate cost without generating */
  dryRun?: boolean;
}

export interface BulkGenerateResult {
  topicsProcessed: number;
  topicsSkipped: number;
  totalNotes: number;
  totalFlashcards: number;
  totalMcqs: number;
  totalTokens: number;
  totalCostUsd: number;
  estimatedCostUsd?: number;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Cost estimates (per topic, based on average token usage)
// ---------------------------------------------------------------------------

const ESTIMATED_TOKENS_PER_TOPIC = {
  notes: { input: 800, output: 2500 },
  flashcards: { input: 600, output: 1500 },
  mcqs: { input: 1000, output: 3000 },
} as const;

function estimateCost(
  topicCount: number,
  options: { notes?: boolean; flashcards?: boolean; mcqs?: boolean }
): number {
  // Notes use PRIMARY (Sonnet), flashcards use BULK (Haiku), MCQs use PRIMARY
  const sonnetInputRate = 3.0 / 1_000_000;
  const sonnetOutputRate = 15.0 / 1_000_000;
  const haikuInputRate = 0.8 / 1_000_000;
  const haikuOutputRate = 4.0 / 1_000_000;

  let cost = 0;
  if (options.notes) {
    const t = ESTIMATED_TOKENS_PER_TOPIC.notes;
    cost += topicCount * (t.input * sonnetInputRate + t.output * sonnetOutputRate);
  }
  if (options.flashcards) {
    const t = ESTIMATED_TOKENS_PER_TOPIC.flashcards;
    cost += topicCount * (t.input * haikuInputRate + t.output * haikuOutputRate);
  }
  if (options.mcqs) {
    const t = ESTIMATED_TOKENS_PER_TOPIC.mcqs;
    cost += topicCount * (t.input * sonnetInputRate + t.output * sonnetOutputRate);
  }
  return cost;
}

// ---------------------------------------------------------------------------
// Priority scoring — determines which topics to fill first
// ---------------------------------------------------------------------------

/** Board priority: CBSE=10, ICSE=8, Kerala=7, others=5 */
const BOARD_PRIORITY: Record<string, number> = {
  CBSE: 10, ICSE: 8, KL_SCERT: 7, KA_KSEAB: 6, TN_DGE: 6,
  MH_MSBSHSE: 6, AP_BSEAP: 5, TS_BSETS: 5,
};

/** Grade priority: 10/12 highest (board exams), then 9/11 */
function gradePriority(grade: number): number {
  if (grade === 10 || grade === 12) return 10;
  if (grade === 9 || grade === 11) return 8;
  if (grade >= 6) return 5;
  return 3;
}

/** Subject priority: STEM subjects first */
const SUBJECT_PRIORITY: Record<string, number> = {
  MATHS: 10, SCIENCE: 10, PHYSICS: 9, CHEMISTRY: 9, BIOLOGY: 9,
  MATHEMATICS: 10, SOCIAL_SCIENCE: 6, ENGLISH: 5, HISTORY: 5,
  GEOGRAPHY: 5, ECONOMICS: 6, POL_SCIENCE: 4, ACCOUNTANCY: 6,
};

function computePriority(boardCode: string, grade: number, subjectCode: string): number {
  const bp = BOARD_PRIORITY[boardCode] ?? 3;
  const gp = gradePriority(grade);
  const sp = SUBJECT_PRIORITY[subjectCode.toUpperCase()] ?? 3;
  return bp * 3 + gp * 2 + sp; // Weighted sum
}

// ---------------------------------------------------------------------------
// findContentGaps — discover topics needing content
// ---------------------------------------------------------------------------

export async function findContentGaps(
  options?: {
    minContentItems?: number;
    boardCodes?: string[];
    grades?: number[];
    subjects?: string[];
    limit?: number;
  }
): Promise<ContentGap[]> {
  const minItems = options?.minContentItems ?? 2;
  const maxResults = options?.limit ?? 500;

  // Query topics with their hierarchy and count of published content_items
  // Using raw SQL for the aggregation with LEFT JOIN
  const gapRows = await db.execute<{
    topic_id: number;
    topic_title: string;
    chapter_title: string;
    subject_name: string;
    subject_code: string;
    grade: number;
    board_code: string;
    board_name: string;
    content_count: number;
    question_count: number;
  }>(sql`
    SELECT
      t.id AS topic_id,
      t.title AS topic_title,
      ch.title AS chapter_title,
      s.name AS subject_name,
      s.code AS subject_code,
      st.grade,
      b.code AS board_code,
      b.name AS board_name,
      COALESCE(ci.cnt, 0)::int AS content_count,
      COALESCE(q.cnt, 0)::int AS question_count
    FROM topics t
    JOIN chapters ch ON ch.id = t.chapter_id
    JOIN subjects s ON s.id = ch.subject_id
    JOIN standards st ON st.id = s.standard_id
    JOIN boards b ON b.id = st.board_id
    LEFT JOIN (
      SELECT topic_id, COUNT(*)::int AS cnt
      FROM content_items
      WHERE is_published = true
      GROUP BY topic_id
    ) ci ON ci.topic_id = t.id
    LEFT JOIN (
      SELECT topic_id, COUNT(*)::int AS cnt
      FROM questions
      GROUP BY topic_id
    ) q ON q.topic_id = t.id
    WHERE COALESCE(ci.cnt, 0) < ${minItems}
    ${options?.boardCodes?.length ? sql`AND b.code = ANY(${options.boardCodes})` : sql``}
    ${options?.grades?.length ? sql`AND st.grade = ANY(${options.grades})` : sql``}
    ${options?.subjects?.length ? sql`AND s.code = ANY(${options.subjects})` : sql``}
    ORDER BY COALESCE(ci.cnt, 0) ASC, st.grade DESC
    LIMIT ${maxResults}
  `);

  // Compute priorities and sort
  const gaps: ContentGap[] = [...gapRows].map((row) => ({
    topicId: row.topic_id,
    topicTitle: row.topic_title,
    chapterTitle: row.chapter_title,
    subjectName: row.subject_name,
    subjectCode: row.subject_code,
    grade: row.grade,
    boardCode: row.board_code,
    boardName: row.board_name,
    publishedContentCount: row.content_count,
    questionCount: row.question_count,
    priority: computePriority(row.board_code, row.grade, row.subject_code),
  }));

  // Sort by priority descending (highest priority first)
  gaps.sort((a, b) => b.priority - a.priority);

  return gaps;
}

// ---------------------------------------------------------------------------
// generateNotesForTopic — Claude Sonnet, high-quality study notes
// ---------------------------------------------------------------------------

export async function generateNotesForTopic(
  topicId: number,
  language: string = "en"
): Promise<{ contentItemId: number; tokens: number; costUsd: number }> {
  const topicCtx = await getTopicContext(topicId);
  if (!topicCtx) throw new Error(`Topic ${topicId} not found`);

  // Check if the chapter already has NCERT/scraped content that we can use as context
  // This avoids generating from scratch when textbook content exists
  const chapterContent = await db
    .select({ body: contentItems.body, sourceType: contentItems.sourceType })
    .from(contentItems)
    .innerJoin(topics, eq(topics.id, contentItems.topicId))
    .where(eq(topics.chapterId, topicCtx.chapterId))
    .limit(1);

  const existingContext = chapterContent[0]?.body?.slice(0, 15000) ?? "";
  const hasContext = existingContext.length > 200;

  const systemPrompt = `You are an expert Indian education content creator for ${topicCtx.boardName} board. Create comprehensive, exam-focused study notes for a Class ${topicCtx.grade} student studying ${topicCtx.subjectName}.

Requirements:
- Use Markdown format with clear H2/H3 headings
- Include: key definitions, concepts, formulas, diagrams described in text, solved examples
- Add exam tips and frequently tested points
- Include a "Quick Revision" summary at the end
- Use bullet points for clarity
- If there are formulas, write them clearly with LaTeX notation where applicable
- Align content with ${topicCtx.boardCode} exam patterns and marking schemes
- Language: ${language === "en" ? "English" : language}
${hasContext ? "\nIMPORTANT: I will provide existing chapter content as reference. Use it to ensure accuracy and consistency, but focus specifically on the requested topic." : ""}`;

  const userPrompt = `Generate comprehensive study notes for:

Board: ${topicCtx.boardCode}
Class: ${topicCtx.grade}
Subject: ${topicCtx.subjectName}
Chapter: ${topicCtx.chapterTitle}
Topic: ${topicCtx.topicTitle}
${topicCtx.description ? `Description: ${topicCtx.description}` : ""}
${Array.isArray(topicCtx.learningObjectives) && topicCtx.learningObjectives.length ? `Learning Objectives:\n${topicCtx.learningObjectives.map((o: unknown) => `- ${String(o)}`).join("\n")}` : ""}
${hasContext ? `\n--- REFERENCE: Existing chapter content (use for context, focus on the specific topic above) ---\n${existingContext}` : ""}`;

  const logCtx: AILogContext = {
    pipelineStage: "content_generation",
    entityType: "topic",
    entityId: topicId,
  };

  const result = await aiChat(userPrompt, {
    model: AI_MODELS.PRIMARY,
    systemPrompt,
    temperature: 0.3,
    maxTokens: 4096,
    language,
  }, logCtx);

  // Store as content_item
  const [item] = await db.insert(contentItems).values({
    topicId,
    contentType: "note",
    title: `${topicCtx.topicTitle} — Study Notes`,
    body: result.content,
    bodyFormat: "markdown",
    sourceType: "ai_generated",
    language,
    qualityScore: computeQualityScore(result.content).toFixed(2),
    reviewStatus: "pending",
    isPublished: false,
    metadata: {
      aiModel: result.model,
      aiProvider: result.provider,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      costUsd: result.costUsd,
      board: topicCtx.boardCode,
      grade: topicCtx.grade,
      subject: topicCtx.subjectCode,
      generatedAt: new Date().toISOString(),
    },
  }).returning({ id: contentItems.id });

  return {
    contentItemId: item.id,
    tokens: result.inputTokens + result.outputTokens,
    costUsd: result.costUsd,
  };
}

// ---------------------------------------------------------------------------
// generateFlashcards — Claude Haiku (cheap, fast)
// ---------------------------------------------------------------------------

export async function generateFlashcards(
  topicId: number,
  count: number = 10,
  language: string = "en"
): Promise<{ contentItemId: number; cardsGenerated: number; tokens: number; costUsd: number }> {
  const topicCtx = await getTopicContext(topicId);
  if (!topicCtx) throw new Error(`Topic ${topicId} not found`);

  const systemPrompt = `You are a flashcard generator for Indian K-12 education. Create concise, exam-focused flashcards. Output a JSON array of objects with "front" (question/prompt) and "back" (answer) fields. Each card should test one specific fact, formula, or concept. Keep answers brief (1-3 sentences). Generate exactly ${count} cards.`;

  const userPrompt = `Generate ${count} flashcards for:
Board: ${topicCtx.boardCode} | Class: ${topicCtx.grade}
Subject: ${topicCtx.subjectName}
Chapter: ${topicCtx.chapterTitle}
Topic: ${topicCtx.topicTitle}
${topicCtx.description ? `Context: ${topicCtx.description}` : ""}

Respond with ONLY a JSON array: [{"front": "...", "back": "..."}, ...]`;

  const logCtx: AILogContext = {
    pipelineStage: "flashcard_generation",
    entityType: "topic",
    entityId: topicId,
  };

  const result = await aiChat(userPrompt, {
    model: AI_MODELS.BULK, // Haiku — 10x cheaper
    systemPrompt,
    temperature: 0.5,
    maxTokens: 2048,
    language,
  }, logCtx);

  // Parse flashcard JSON
  let cards: Array<{ front: string; back: string }> = [];
  try {
    const jsonMatch = result.content.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      cards = JSON.parse(jsonMatch[0]);
    }
  } catch {
    // If JSON parsing fails, store raw content
  }

  // Build markdown body from cards
  const body = cards.length > 0
    ? cards.map((c, i) => `### Card ${i + 1}\n**Q:** ${c.front}\n\n**A:** ${c.back}`).join("\n\n---\n\n")
    : result.content;

  const [item] = await db.insert(contentItems).values({
    topicId,
    contentType: "flashcard_set",
    title: `${topicCtx.topicTitle} — Flashcards (${cards.length})`,
    body,
    bodyFormat: "markdown",
    sourceType: "ai_generated",
    language,
    qualityScore: computeQualityScore(body).toFixed(2),
    reviewStatus: "pending",
    isPublished: false,
    metadata: {
      aiModel: result.model,
      aiProvider: result.provider,
      cardCount: cards.length,
      cards, // Store structured cards for frontend rendering
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      costUsd: result.costUsd,
      board: topicCtx.boardCode,
      grade: topicCtx.grade,
      subject: topicCtx.subjectCode,
      generatedAt: new Date().toISOString(),
    },
  }).returning({ id: contentItems.id });

  return {
    contentItemId: item.id,
    cardsGenerated: cards.length,
    tokens: result.inputTokens + result.outputTokens,
    costUsd: result.costUsd,
  };
}

// ---------------------------------------------------------------------------
// generateMCQs — Claude Sonnet, stored in questions table
// ---------------------------------------------------------------------------

export async function generateMCQs(
  topicId: number,
  count: number = 5,
  language: string = "en"
): Promise<{ questionsGenerated: number; questionIds: number[]; tokens: number; costUsd: number }> {
  const topicCtx = await getTopicContext(topicId);
  if (!topicCtx) throw new Error(`Topic ${topicId} not found`);

  const systemPrompt = `You are an expert MCQ question creator for ${topicCtx.boardCode} board exams. Generate ${count} high-quality multiple-choice questions for Class ${topicCtx.grade} ${topicCtx.subjectName}.

Each question MUST have:
- questionText: The question stem
- options: Array of 4 options, each with "label" (A/B/C/D), "text", and "isCorrect" (exactly one true)
- correctAnswer: The correct option label (A, B, C, or D)
- solution: Brief explanation of why the correct answer is correct
- difficulty: "easy", "medium", or "hard"
- bloomLevel: One of "Remember", "Understand", "Apply", "Analyze"

Output as a JSON object: { "questions": [...] }`;

  const userPrompt = `Generate ${count} MCQs for:
Board: ${topicCtx.boardCode} | Class: ${topicCtx.grade}
Subject: ${topicCtx.subjectName}
Chapter: ${topicCtx.chapterTitle}
Topic: ${topicCtx.topicTitle}
${topicCtx.description ? `Context: ${topicCtx.description}` : ""}

Mix difficulty levels (2 easy, 2 medium, 1 hard). Follow ${topicCtx.boardCode} exam patterns.
Respond with JSON only.`;

  const logCtx: AILogContext = {
    pipelineStage: "mcq_generation",
    entityType: "topic",
    entityId: topicId,
  };

  const result = await aiChat(userPrompt, {
    model: AI_MODELS.PRIMARY, // Sonnet — quality matters for questions
    systemPrompt,
    temperature: 0.5,
    maxTokens: 4096,
    language,
  }, logCtx);

  // Parse questions JSON
  interface ParsedMCQ {
    questionText: string;
    options: Array<{ label: string; text: string; isCorrect: boolean }>;
    correctAnswer: string;
    solution: string;
    difficulty: string;
    bloomLevel?: string;
  }

  let parsedQuestions: ParsedMCQ[] = [];
  try {
    const jsonMatch = result.content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      parsedQuestions = parsed.questions ?? parsed;
    }
  } catch {
    // JSON parsing failed
  }

  // Insert into questions table
  const insertedIds: number[] = [];

  for (const q of parsedQuestions) {
    if (!q.questionText || !q.options?.length) continue;

    try {
      const [inserted] = await db.insert(questions).values({
        topicId,
        questionType: "mcq",
        difficulty: q.difficulty ?? "medium",
        bloomLevel: q.bloomLevel ?? "Understand",
        questionText: q.questionText,
        options: q.options,
        correctAnswer: q.correctAnswer ?? q.options.find((o) => o.isCorrect)?.label ?? "A",
        solution: q.solution ?? "",
        marks: "1.0",
        negativeMarks: "0.0",
        sourceType: "ai_generated",
        language,
        isVerified: false,
        tags: [topicCtx.subjectCode, `class-${topicCtx.grade}`, topicCtx.boardCode],
        metadata: {
          aiModel: result.model,
          aiProvider: result.provider,
          board: topicCtx.boardCode,
          grade: topicCtx.grade,
          subject: topicCtx.subjectCode,
          generatedAt: new Date().toISOString(),
        },
      }).returning({ id: questions.id });

      insertedIds.push(inserted.id);
    } catch (err) {
      console.error(`[ContentGen] Failed to insert MCQ: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return {
    questionsGenerated: insertedIds.length,
    questionIds: insertedIds,
    tokens: result.inputTokens + result.outputTokens,
    costUsd: result.costUsd,
  };
}

// ---------------------------------------------------------------------------
// bulkGenerateContent — processes batches via BullMQ
// ---------------------------------------------------------------------------

export async function bulkGenerateContent(
  options: BulkGenerateOptions
): Promise<BulkGenerateResult> {
  const log = (msg: string) => console.log(`[ContentGen Bulk] ${msg}`);

  const batchSize = options.batchSize ?? 50;
  const generateNotes = options.notes ?? true;
  const generateFlashcardsFlag = options.flashcards ?? true;
  const generateMcqsFlag = options.mcqs ?? true;
  const language = options.language ?? "en";

  // Find gaps
  log("Finding content gaps...");
  const gaps = await findContentGaps({
    boardCodes: options.boardCodes,
    grades: options.grades,
    subjects: options.subjects,
    limit: batchSize,
  });

  log(`Found ${gaps.length} topics with content gaps`);

  // Dry run — cost estimation only
  if (options.dryRun) {
    const estimated = estimateCost(gaps.length, {
      notes: generateNotes,
      flashcards: generateFlashcardsFlag,
      mcqs: generateMcqsFlag,
    });

    log(`DRY RUN — Estimated cost: $${estimated.toFixed(4)} for ${gaps.length} topics`);

    return {
      topicsProcessed: 0,
      topicsSkipped: 0,
      totalNotes: 0,
      totalFlashcards: 0,
      totalMcqs: 0,
      totalTokens: 0,
      totalCostUsd: 0,
      estimatedCostUsd: estimated,
      errors: [],
    };
  }

  const result: BulkGenerateResult = {
    topicsProcessed: 0,
    topicsSkipped: 0,
    totalNotes: 0,
    totalFlashcards: 0,
    totalMcqs: 0,
    totalTokens: 0,
    totalCostUsd: 0,
    errors: [],
  };

  for (let i = 0; i < gaps.length; i++) {
    const gap = gaps[i];
    log(`\n[${i + 1}/${gaps.length}] ${gap.topicTitle} (${gap.boardCode} Class ${gap.grade} ${gap.subjectName})`);

    try {
      // Notes
      if (generateNotes) {
        try {
          const notesResult = await generateNotesForTopic(gap.topicId, language);
          result.totalNotes++;
          result.totalTokens += notesResult.tokens;
          result.totalCostUsd += notesResult.costUsd;
          log(`  Notes: ✓ ($${notesResult.costUsd.toFixed(4)})`);
        } catch (err) {
          result.errors.push(`Notes for topic ${gap.topicId}: ${err instanceof Error ? err.message : String(err)}`);
          log(`  Notes: ✗`);
        }
      }

      // Flashcards
      if (generateFlashcardsFlag) {
        try {
          const fcResult = await generateFlashcards(gap.topicId, options.flashcardCount ?? 10, language);
          result.totalFlashcards += fcResult.cardsGenerated;
          result.totalTokens += fcResult.tokens;
          result.totalCostUsd += fcResult.costUsd;
          log(`  Flashcards: ${fcResult.cardsGenerated} cards ($${fcResult.costUsd.toFixed(4)})`);
        } catch (err) {
          result.errors.push(`Flashcards for topic ${gap.topicId}: ${err instanceof Error ? err.message : String(err)}`);
          log(`  Flashcards: ✗`);
        }
      }

      // MCQs
      if (generateMcqsFlag) {
        try {
          const mcqResult = await generateMCQs(gap.topicId, options.mcqCount ?? 5, language);
          result.totalMcqs += mcqResult.questionsGenerated;
          result.totalTokens += mcqResult.tokens;
          result.totalCostUsd += mcqResult.costUsd;
          log(`  MCQs: ${mcqResult.questionsGenerated} questions ($${mcqResult.costUsd.toFixed(4)})`);
        } catch (err) {
          result.errors.push(`MCQs for topic ${gap.topicId}: ${err instanceof Error ? err.message : String(err)}`);
          log(`  MCQs: ✗`);
        }
      }

      result.topicsProcessed++;
    } catch (err) {
      result.topicsSkipped++;
      result.errors.push(`Topic ${gap.topicId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  log(`\n=== Bulk Generation Summary ===`);
  log(`Topics: ${result.topicsProcessed} processed, ${result.topicsSkipped} skipped`);
  log(`Notes: ${result.totalNotes} | Flashcards: ${result.totalFlashcards} | MCQs: ${result.totalMcqs}`);
  log(`Total cost: $${result.totalCostUsd.toFixed(4)} | Tokens: ${result.totalTokens}`);

  return result;
}

// ---------------------------------------------------------------------------
// Topic context helper
// ---------------------------------------------------------------------------

interface TopicContext {
  topicId: number;
  topicTitle: string;
  description: string | null;
  learningObjectives: unknown;
  chapterId: number;
  chapterTitle: string;
  subjectName: string;
  subjectCode: string;
  grade: number;
  boardCode: string;
  boardName: string;
}

async function getTopicContext(topicId: number): Promise<TopicContext | null> {
  const rows = await db
    .select({
      topicId: topics.id,
      topicTitle: topics.title,
      description: topics.description,
      learningObjectives: topics.learningObjectives,
      chapterId: chapters.id,
      chapterTitle: chapters.title,
      subjectName: subjects.name,
      subjectCode: subjects.code,
      grade: standards.grade,
      boardCode: boards.code,
      boardName: boards.name,
    })
    .from(topics)
    .innerJoin(chapters, eq(chapters.id, topics.chapterId))
    .innerJoin(subjects, eq(subjects.id, chapters.subjectId))
    .innerJoin(standards, eq(standards.id, subjects.standardId))
    .innerJoin(boards, eq(boards.id, standards.boardId))
    .where(eq(topics.id, topicId))
    .limit(1);

  return rows[0] ?? null;
}
