/**
 * Generate a full explainer deck for a topic at a given difficulty level.
 * Called by the bulk job (background) and by the student API as a fallback
 * when a deck doesn't exist yet.
 */
import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import { topics, chapters, subjects, standards, boards } from "@/db/schema/curriculum";
import { topicExplainerDecks } from "@/db/schema/explainers";
import { aiChat, AI_MODELS } from "@/lib/ai/provider";
import {
  buildDeckUserPrompt,
  EXPLAINER_SYSTEM_PROMPT,
} from "@/lib/ai/prompts/visual-explainer";
import {
  ExplainerCardSchema,
  cardHasVisual,
  extractJson,
  type ExplainerCard,
} from "./types";

export interface GenerateDeckResult {
  deckId: number;
  cards: ExplainerCard[];
  totalReadTime: number;
  costUsd: number;
}

interface TopicContext {
  topicId: number;
  topicTitle: string;
  chapterTitle?: string;
  subjectName?: string;
  subjectId?: number;
  boardName?: string;
  boardId?: number;
  standardId?: number;
  grade?: number | null;
  learningObjectives?: string[];
}

async function loadTopicContext(topicId: number): Promise<TopicContext | null> {
  const rows = await db
    .select({
      topicId: topics.id,
      topicTitle: topics.title,
      learningObjectives: topics.learningObjectives,
      chapterTitle: chapters.title,
      subjectId: subjects.id,
      subjectName: subjects.name,
      standardId: standards.id,
      grade: standards.grade,
      boardId: boards.id,
      boardName: boards.name,
    })
    .from(topics)
    .leftJoin(chapters, eq(chapters.id, topics.chapterId))
    .leftJoin(subjects, eq(subjects.id, chapters.subjectId))
    .leftJoin(standards, eq(standards.id, subjects.standardId))
    .leftJoin(boards, eq(boards.id, standards.boardId))
    .where(eq(topics.id, topicId))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  const objectives = Array.isArray(row.learningObjectives)
    ? (row.learningObjectives as unknown[]).filter(
        (x): x is string => typeof x === "string"
      )
    : [];

  return {
    topicId: Number(row.topicId),
    topicTitle: row.topicTitle,
    chapterTitle: row.chapterTitle ?? undefined,
    subjectName: row.subjectName ?? undefined,
    subjectId: row.subjectId != null ? Number(row.subjectId) : undefined,
    standardId: row.standardId != null ? Number(row.standardId) : undefined,
    boardId: row.boardId != null ? Number(row.boardId) : undefined,
    boardName: row.boardName ?? undefined,
    grade: row.grade ?? null,
    learningObjectives: objectives,
  };
}

export async function generateTopicDeck(
  topicId: number,
  level: 1 | 2 | 3,
  language: string = "en",
  opts: {
    model?: (typeof AI_MODELS)[keyof typeof AI_MODELS];
    maxCards?: number;
  } = {}
): Promise<GenerateDeckResult> {
  const ctx = await loadTopicContext(topicId);
  if (!ctx) {
    throw new Error(`Topic ${topicId} not found`);
  }

  const userPrompt = buildDeckUserPrompt({
    topicTitle: ctx.topicTitle,
    chapterTitle: ctx.chapterTitle,
    subjectName: ctx.subjectName,
    boardName: ctx.boardName,
    grade: ctx.grade,
    level,
    language,
    learningObjectives: ctx.learningObjectives,
    maxCards: opts.maxCards,
  });

  // SVG diagrams are token-heavy — a 3–7 card deck with several inline SVGs
  // routinely needs >10k output tokens. Too low a cap truncates the JSON
  // mid-SVG and the parse fails with a misleading syntax error.
  const maxTokens = 16000;

  const result = await aiChat(
    userPrompt,
    {
      // Default Sonnet (best quality) for bulk pre-generation; callers can pass
      // a faster model (Haiku) for on-demand first-open so students don't wait
      // 30–40s. Pre-generated Sonnet decks always take precedence when present.
      model: opts.model ?? AI_MODELS.PRIMARY,
      systemPrompt: EXPLAINER_SYSTEM_PROMPT,
      temperature: 0.4,
      maxTokens,
      language,
    },
    {
      pipelineStage: "explainer_deck_generate",
      entityType: "topic",
      entityId: topicId,
    }
  );

  // Detect truncation up front so the failure is actionable rather than a
  // cryptic "Expected ',' or ']'" from JSON.parse on a half-written SVG.
  if (result.outputTokens >= maxTokens) {
    throw new Error(
      `Deck generation hit the ${maxTokens}-token output cap (likely truncated mid-card). ` +
        `Topic ${topicId} may need fewer/simpler cards or a higher cap.`
    );
  }

  // Parse + validate. We validate CARD BY CARD and keep the good ones rather
  // than rejecting the whole deck if a single card is malformed — faster models
  // (Haiku) occasionally emit one off-spec card, and salvaging the rest is far
  // better UX than a hard failure.
  const raw = extractJson(result.content);
  const rawCards: unknown[] = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { cards?: unknown }).cards)
      ? ((raw as { cards: unknown[] }).cards)
      : [];

  if (rawCards.length === 0) {
    throw new Error("AI returned no cards array");
  }

  const validCards: ExplainerCard[] = [];
  let rejected = 0;
  for (const candidate of rawCards) {
    const parsed = ExplainerCardSchema.safeParse(candidate);
    if (!parsed.success) {
      rejected++;
      continue; // skip a malformed card, keep the rest
    }
    if (!cardHasVisual(parsed.data)) {
      rejected++;
      continue; // skip text-only cards — the prompt forbids them
    }
    validCards.push({
      ...parsed.data,
      position: validCards.length + 1,
      isPreGenerated: true,
    });
  }

  if (rejected > 0) {
    console.warn(
      `[explainer] topic ${topicId}: kept ${validCards.length}/${rawCards.length} cards (${rejected} invalid/text-only)`
    );
  }

  // Need at least a couple of usable cards to be worth showing.
  if (validCards.length < 2) {
    throw new Error(
      `AI returned too few valid cards (${validCards.length}); regenerate.`
    );
  }

  const totalReadTime = validCards.reduce(
    (sum, c) => sum + (c.estimatedReadTime ?? 60),
    0
  );

  // Upsert — delete any prior deck at (topic, level, language) then insert.
  // We avoid onConflictDoUpdate because the card_count/cost numbers should
  // reflect the fresh generation cleanly.
  await db
    .delete(topicExplainerDecks)
    .where(
      and(
        eq(topicExplainerDecks.topicId, topicId),
        eq(topicExplainerDecks.level, level),
        eq(topicExplainerDecks.language, language)
      )
    );

  const [inserted] = await db
    .insert(topicExplainerDecks)
    .values({
      topicId,
      boardId: ctx.boardId ?? null,
      standardId: ctx.standardId ?? null,
      subjectId: ctx.subjectId ?? null,
      level,
      cardsJson: validCards,
      cardCount: validCards.length,
      totalReadTime,
      language,
      generationModel: result.model,
      generationCost: result.costUsd.toFixed(4),
    })
    .returning({ id: topicExplainerDecks.id });

  return {
    deckId: Number(inserted.id),
    cards: validCards,
    totalReadTime,
    costUsd: result.costUsd,
  };
}

export { ExplainerCardSchema };
