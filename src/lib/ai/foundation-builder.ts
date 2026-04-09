/**
 * Foundation Builder Agent — v2
 *
 * Generates shared prerequisite/foundational content stored in content_items.
 * First request generates; all subsequent students get the cached version.
 * Also creates a personal userNotes entry for the student's journal.
 */
import { eq, and, sql, lt, asc, desc, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  boards,
  standards,
  subjects,
  chapters,
  topics,
  topicMappings,
} from "@/db/schema/curriculum";
import { contentItems, userNotes } from "@/db/schema/content";
import { aiChat, AI_MODELS } from "./provider";
import type { AILogContext } from "./provider";
import {
  SYSTEM_PROMPT,
  config as promptConfig,
} from "./prompts/foundation-builder";
import { processImagePlaceholders } from "./image-generator";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TopicContext {
  topicId: number;
  topicTitle: string;
  description: string | null;
  learningObjectives: unknown;
  chapterId: number;
  chapterNumber: number;
  chapterTitle: string;
  subjectId: number;
  subjectName: string;
  subjectCode: string;
  standardId: number;
  grade: number;
  boardId: number;
  boardCode: string;
  boardName: string;
}

interface EarlierTopic {
  id: number;
  title: string;
  description: string | null;
  chapterNumber: number;
  chapterTitle: string;
  grade: number;
  contentSnippet?: string;
}

export interface FoundationResult {
  contentItemId: number;
  noteId: number | null;
  title: string;
  body: string;
  cached: boolean;
  prerequisiteCount: number;
  tokens: number;
  costUsd: number;
}

// ---------------------------------------------------------------------------
// Topic context helper
// ---------------------------------------------------------------------------

async function getTopicContext(
  topicId: number
): Promise<TopicContext | null> {
  const rows = await db
    .select({
      topicId: topics.id,
      topicTitle: topics.title,
      description: topics.description,
      learningObjectives: topics.learningObjectives,
      chapterId: chapters.id,
      chapterNumber: chapters.chapterNumber,
      chapterTitle: chapters.title,
      subjectId: subjects.id,
      subjectName: subjects.name,
      subjectCode: subjects.code,
      standardId: standards.id,
      grade: standards.grade,
      boardId: boards.id,
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

// ---------------------------------------------------------------------------
// Earlier topics queries
// ---------------------------------------------------------------------------

async function getEarlierTopicsSameGrade(
  subjectId: number,
  currentChapterNumber: number
): Promise<EarlierTopic[]> {
  return db
    .select({
      id: topics.id,
      title: topics.title,
      description: topics.description,
      chapterNumber: chapters.chapterNumber,
      chapterTitle: chapters.title,
      grade: standards.grade,
    })
    .from(topics)
    .innerJoin(chapters, eq(chapters.id, topics.chapterId))
    .innerJoin(subjects, eq(subjects.id, chapters.subjectId))
    .innerJoin(standards, eq(standards.id, subjects.standardId))
    .where(
      and(
        eq(chapters.subjectId, subjectId),
        lt(chapters.chapterNumber, currentChapterNumber)
      )
    )
    .orderBy(asc(chapters.chapterNumber), asc(topics.sortOrder))
    .limit(30);
}

async function getEarlierTopicsPreviousGrades(
  subjectCode: string,
  boardId: number,
  currentGrade: number,
  minGrade: number
): Promise<EarlierTopic[]> {
  return db
    .select({
      id: topics.id,
      title: topics.title,
      description: topics.description,
      chapterNumber: chapters.chapterNumber,
      chapterTitle: chapters.title,
      grade: standards.grade,
    })
    .from(topics)
    .innerJoin(chapters, eq(chapters.id, topics.chapterId))
    .innerJoin(subjects, eq(subjects.id, chapters.subjectId))
    .innerJoin(standards, eq(standards.id, subjects.standardId))
    .where(
      and(
        eq(subjects.code, subjectCode),
        eq(standards.boardId, boardId),
        lt(standards.grade, currentGrade),
        sql`${standards.grade} >= ${minGrade}`
      )
    )
    .orderBy(desc(standards.grade), asc(chapters.chapterNumber), asc(topics.sortOrder))
    .limit(30);
}

// ---------------------------------------------------------------------------
// Content snippets
// ---------------------------------------------------------------------------

async function getContentSnippets(
  topicIds: number[]
): Promise<Map<number, string>> {
  if (topicIds.length === 0) return new Map();

  const rows = await db
    .select({ topicId: contentItems.topicId, body: contentItems.body })
    .from(contentItems)
    .where(
      and(
        inArray(contentItems.topicId, topicIds),
        eq(contentItems.isPublished, true)
      )
    )
    .limit(50);

  const map = new Map<number, string>();
  for (const row of rows) {
    if (row.topicId && row.body) {
      map.set(row.topicId, row.body.slice(0, 300));
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Check for existing shared foundation content
// ---------------------------------------------------------------------------

async function getExistingFoundation(
  topicId: number
): Promise<{ id: number; title: string; body: string } | null> {
  const rows = await db
    .select({
      id: contentItems.id,
      title: contentItems.title,
      body: contentItems.body,
    })
    .from(contentItems)
    .where(
      and(
        eq(contentItems.topicId, topicId),
        eq(contentItems.contentType, "foundation"),
        eq(contentItems.isPublished, true)
      )
    )
    .orderBy(desc(contentItems.createdAt))
    .limit(1);

  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

function buildUserPrompt(
  ctx: TopicContext,
  sameGradeTopics: EarlierTopic[],
  prevGradeTopics: EarlierTopic[],
  snippets: Map<number, string>
): string {
  const objectives = Array.isArray(ctx.learningObjectives)
    ? (ctx.learningObjectives as string[]).map((o) => `- ${o}`).join("\n")
    : "";

  let prompt = `Build a foundations document for this topic:

**Board:** ${ctx.boardCode}
**Class:** ${ctx.grade}
**Subject:** ${ctx.subjectName}
**Chapter:** ${ctx.chapterNumber} - ${ctx.chapterTitle}
**Topic:** ${ctx.topicTitle}`;

  if (ctx.description) prompt += `\n**Description:** ${ctx.description}`;
  if (objectives) prompt += `\n**Learning Objectives:**\n${objectives}`;

  prompt += `\n\nBelow are earlier topics in this subject that MAY be prerequisites. Identify which ones are truly needed, then explain each relevant prerequisite.\n`;

  if (sameGradeTopics.length > 0) {
    prompt += `\n### Class ${ctx.grade}, Earlier Chapters:\n`;
    let currentCh = -1;
    for (const t of sameGradeTopics) {
      if (t.chapterNumber !== currentCh) {
        currentCh = t.chapterNumber;
        prompt += `\n**Ch ${t.chapterNumber}: ${t.chapterTitle}**\n`;
      }
      const snippet = snippets.get(t.id);
      prompt += `- ${t.title}`;
      if (snippet) prompt += ` _(${snippet.slice(0, 150).replace(/\n/g, " ")}...)_`;
      prompt += "\n";
    }
  }

  if (prevGradeTopics.length > 0) {
    let currentGrade = -1;
    for (const t of prevGradeTopics) {
      if (t.grade !== currentGrade) {
        currentGrade = t.grade;
        prompt += `\n### Class ${t.grade}, Same Subject (${ctx.subjectName}):\n`;
      }
      const snippet = snippets.get(t.id);
      prompt += `- Ch ${t.chapterNumber}: ${t.title}`;
      if (snippet) prompt += ` _(${snippet.slice(0, 100).replace(/\n/g, " ")}...)_`;
      prompt += "\n";
    }
  }

  if (sameGradeTopics.length === 0 && prevGradeTopics.length === 0) {
    prompt += `\n(No earlier topics found in the database. Use your knowledge of the ${ctx.boardCode} Class ${ctx.grade} ${ctx.subjectName} curriculum to identify prerequisites.)\n`;
  }

  prompt += `\n---\n
For each prerequisite you identify:
1. Give it an ## H2 heading
2. Start with a Definition blockquote
3. Include key formulas with LaTeX
4. Add a Mermaid diagram (flowchart, graph, or mindmap) showing concept relationships
5. If it's a visual concept (geometry, science diagrams, maps), add an image placeholder: ![description](GENERATE_IMAGE: detailed prompt)
6. Include 2-3 worked examples at different difficulty levels
7. Add a "Watch Out!" common mistakes callout
8. Include 2-3 quick self-check Q&As
9. Explain why this matters for "${ctx.topicTitle}"

Start with a Learning Roadmap (Mermaid flowchart).
End with a concept mind map (Mermaid mindmap) and a "## Bridge to ${ctx.topicTitle}" section.`;

  return prompt;
}

// ---------------------------------------------------------------------------
// Prerequisite mapping
// ---------------------------------------------------------------------------

async function savePrerequisiteMappings(
  currentTopicId: number,
  earlierTopics: EarlierTopic[],
  aiContent: string
): Promise<number> {
  if (earlierTopics.length === 0) return 0;

  const contentLower = aiContent.toLowerCase();
  const matched: { topicId: number; score: number }[] = [];

  for (const t of earlierTopics) {
    const titleWords = t.title.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
    const matchCount = titleWords.filter((w) => contentLower.includes(w)).length;
    const matchRatio = titleWords.length > 0 ? matchCount / titleWords.length : 0;
    if (matchRatio >= 0.5) {
      matched.push({ topicId: t.id, score: Math.round(matchRatio * 100) / 100 });
    }
  }

  for (const m of matched) {
    const existing = await db
      .select({ id: topicMappings.id })
      .from(topicMappings)
      .where(
        and(
          eq(topicMappings.sourceTopicId, m.topicId),
          eq(topicMappings.targetTopicId, currentTopicId)
        )
      )
      .limit(1);

    if (existing.length === 0) {
      await db.insert(topicMappings).values({
        sourceTopicId: m.topicId,
        targetTopicId: currentTopicId,
        mappingType: "foundation",
        similarityScore: String(m.score),
      });
    }
  }

  return matched.length;
}

// ---------------------------------------------------------------------------
// Main: on-demand (student-facing)
// ---------------------------------------------------------------------------

export async function getOrBuildFoundation(
  topicId: number,
  userId: number
): Promise<FoundationResult> {
  // 1. Check for existing shared content
  const existing = await getExistingFoundation(topicId);
  if (existing) {
    // Ensure student has a journal entry pointing to this
    await ensureJournalEntry(userId, topicId, existing.id, existing.title);

    return {
      contentItemId: existing.id,
      noteId: null,
      title: existing.title,
      body: existing.body,
      cached: true,
      prerequisiteCount: 0,
      tokens: 0,
      costUsd: 0,
    };
  }

  // 2. Generate new foundation content
  return generateFoundation(topicId, userId);
}

// ---------------------------------------------------------------------------
// Core generation logic (used by both on-demand and bulk)
// ---------------------------------------------------------------------------

export async function generateFoundation(
  topicId: number,
  userId?: number
): Promise<FoundationResult> {
  const ctx = await getTopicContext(topicId);
  if (!ctx) throw new Error(`Topic ${topicId} not found`);

  // Query earlier topics
  const sameGradeTopics = await getEarlierTopicsSameGrade(
    ctx.subjectId,
    ctx.chapterNumber
  );
  const minGrade = Math.max(1, ctx.grade - 2);
  const prevGradeTopics = await getEarlierTopicsPreviousGrades(
    ctx.subjectCode,
    ctx.boardId,
    ctx.grade,
    minGrade
  );

  const allTopicIds = [
    ...sameGradeTopics.map((t) => t.id),
    ...prevGradeTopics.map((t) => t.id),
  ];
  const snippets = await getContentSnippets(allTopicIds);

  // Build and send prompt
  const userPrompt = buildUserPrompt(ctx, sameGradeTopics, prevGradeTopics, snippets);

  const logContext: AILogContext = {
    pipelineStage: "foundation_builder",
    entityType: "topic",
    entityId: topicId,
  };

  const result = await aiChat(
    userPrompt,
    {
      model: AI_MODELS.PRIMARY,
      systemPrompt: SYSTEM_PROMPT,
      temperature: promptConfig.temperature,
      maxTokens: promptConfig.maxTokens,
    },
    logContext
  );

  // Process image placeholders (DALL-E generation)
  let processedBody = result.content;
  try {
    processedBody = await processImagePlaceholders(result.content);
  } catch (err) {
    console.warn("[FoundationBuilder] Image processing failed, using text fallback:", err);
  }

  // Save to content_items (shared)
  const title = `Foundations for: ${ctx.topicTitle}`;
  const [item] = await db
    .insert(contentItems)
    .values({
      topicId,
      contentType: "foundation",
      title,
      body: processedBody,
      bodyFormat: "markdown",
      sourceType: "ai_generated",
      language: "en",
      reviewStatus: "auto_approved",
      isPublished: true,
      metadata: {
        aiModel: result.model,
        aiProvider: result.provider,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costUsd: result.costUsd,
        board: ctx.boardCode,
        grade: ctx.grade,
        subject: ctx.subjectCode,
        generatedAt: new Date().toISOString(),
        hasMermaid: processedBody.includes("```mermaid"),
        hasImages: processedBody.includes("/api/uploads/foundations/"),
      },
    })
    .returning({ id: contentItems.id });

  // Save prerequisite mappings (non-blocking)
  let prerequisiteCount = 0;
  try {
    const allEarlier = [...sameGradeTopics, ...prevGradeTopics];
    prerequisiteCount = await savePrerequisiteMappings(topicId, allEarlier, processedBody);
  } catch (err) {
    console.warn("[FoundationBuilder] Mapping save failed:", err);
  }

  // Create journal entry for the requesting user
  let noteId: number | null = null;
  if (userId) {
    noteId = await ensureJournalEntry(userId, topicId, item.id, title);
  }

  return {
    contentItemId: item.id,
    noteId,
    title,
    body: processedBody,
    cached: false,
    prerequisiteCount,
    tokens: result.inputTokens + result.outputTokens,
    costUsd: result.costUsd,
  };
}

// ---------------------------------------------------------------------------
// Journal entry helper
// ---------------------------------------------------------------------------

async function ensureJournalEntry(
  userId: number,
  topicId: number,
  contentItemId: number,
  title: string
): Promise<number> {
  // Check if user already has a foundation note for this topic
  const existing = await db
    .select({ id: userNotes.id })
    .from(userNotes)
    .where(
      and(
        eq(userNotes.userId, userId),
        eq(userNotes.topicId, topicId),
        sql`'ai-foundations' = ANY(${userNotes.tags})`
      )
    )
    .limit(1);

  if (existing.length > 0) return existing[0].id;

  const [note] = await db
    .insert(userNotes)
    .values({
      userId,
      topicId,
      title,
      body: `*This foundation guide is shared content. [View full content](/dashboard/learn/${topicId}?panel=notes)*\n\nGenerated by AI to help you understand the prerequisites for this topic.`,
      bodyFormat: "markdown",
      noteType: "typed",
      tags: ["ai-foundations"],
      contentItemId,
      isPrivate: true,
    })
    .returning({ id: userNotes.id });

  return note.id;
}

// ---------------------------------------------------------------------------
// Bulk generation (admin)
// ---------------------------------------------------------------------------

export interface BulkFoundationOptions {
  topicIds?: number[];
  boardCodes?: string[];
  grades?: number[];
  batchSize?: number;
  dryRun?: boolean;
}

export interface BulkFoundationResult {
  processed: number;
  skipped: number;
  errors: string[];
  totalTokens: number;
  totalCostUsd: number;
}

export async function bulkGenerateFoundations(
  options: BulkFoundationOptions
): Promise<BulkFoundationResult> {
  const batchSize = options.batchSize ?? 20;
  const result: BulkFoundationResult = {
    processed: 0,
    skipped: 0,
    errors: [],
    totalTokens: 0,
    totalCostUsd: 0,
  };

  // Find topics that don't have foundation content yet
  const conditions = [
    sql`${topics.id} NOT IN (
      SELECT topic_id FROM content_items
      WHERE content_type = 'foundation' AND is_published = true
    )`,
  ];

  if (options.topicIds && options.topicIds.length > 0) {
    conditions.push(inArray(topics.id, options.topicIds));
  }

  const gaps = await db
    .select({
      topicId: topics.id,
      topicTitle: topics.title,
      boardCode: boards.code,
      grade: standards.grade,
    })
    .from(topics)
    .innerJoin(chapters, eq(chapters.id, topics.chapterId))
    .innerJoin(subjects, eq(subjects.id, chapters.subjectId))
    .innerJoin(standards, eq(standards.id, subjects.standardId))
    .innerJoin(boards, eq(boards.id, standards.boardId))
    .where(and(...conditions))
    .orderBy(asc(boards.code), asc(standards.grade), asc(chapters.chapterNumber))
    .limit(batchSize);

  if (options.dryRun) {
    return {
      ...result,
      processed: gaps.length,
      errors: [`Dry run: ${gaps.length} topics need foundation content`],
    };
  }

  for (const gap of gaps) {
    try {
      console.log(`[FoundationBulk] Generating for: ${gap.topicTitle} (${gap.boardCode} Class ${gap.grade})`);
      const res = await generateFoundation(gap.topicId);
      result.processed++;
      result.totalTokens += res.tokens;
      result.totalCostUsd += res.costUsd;
    } catch (err) {
      result.errors.push(
        `${gap.topicTitle}: ${err instanceof Error ? err.message : String(err)}`
      );
      result.skipped++;
    }
  }

  return result;
}
