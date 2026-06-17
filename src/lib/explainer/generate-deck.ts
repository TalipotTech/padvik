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
  ExplainerDeckSchema,
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
  language: string = "en"
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
  });

  // SVG diagrams are token-heavy — a 3–7 card deck with several inline SVGs
  // routinely needs >10k output tokens. Too low a cap truncates the JSON
  // mid-SVG and the parse fails with a misleading syntax error.
  const maxTokens = 16000;

  const result = await aiChat(
    userPrompt,
    {
      model: AI_MODELS.PRIMARY,
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

  // Parse + validate
  const raw = extractJson(result.content);
  const parsed = ExplainerDeckSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `AI returned invalid deck JSON: ${parsed.error.issues[0]?.message ?? "unknown"}`
    );
  }

  const validCards: ExplainerCard[] = [];
  for (let i = 0; i < parsed.data.cards.length; i++) {
    const card = parsed.data.cards[i];
    if (!cardHasVisual(card)) {
      // Skip text-only cards — the prompt forbids them.
      continue;
    }
    validCards.push({
      ...card,
      position: i + 1,
      isPreGenerated: true,
    });
  }

  if (validCards.length === 0) {
    throw new Error("AI returned no cards with visuals");
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
