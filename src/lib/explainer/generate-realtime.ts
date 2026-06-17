/**
 * Generate ONE re-explanation or Q&A answer card in real time.
 * Used when the student taps "Explain more" or asks a question.
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { topics, chapters, subjects } from "@/db/schema/curriculum";
import { aiChat, AI_MODELS } from "@/lib/ai/provider";
import {
  buildReExplainUserPrompt,
  EXPLAINER_SYSTEM_PROMPT,
} from "@/lib/ai/prompts/visual-explainer";
import {
  ExplainerDeckSchema,
  cardHasVisual,
  extractJson,
  type Approach,
  type ExplainerCard,
} from "./types";

export interface ReExplanationResult {
  card: ExplainerCard;
  costUsd: number;
}

export async function generateReExplanation(options: {
  topicId: number;
  level: 1 | 2 | 3;
  previousApproaches: Approach[];
  studentQuestion?: string;
  language?: string;
}): Promise<ReExplanationResult> {
  const { topicId, level, previousApproaches, studentQuestion, language = "en" } =
    options;

  const rows = await db
    .select({
      topicTitle: topics.title,
      chapterTitle: chapters.title,
      subjectName: subjects.name,
    })
    .from(topics)
    .leftJoin(chapters, eq(chapters.id, topics.chapterId))
    .leftJoin(subjects, eq(subjects.id, chapters.subjectId))
    .where(eq(topics.id, topicId))
    .limit(1);

  const row = rows[0];
  if (!row) {
    throw new Error(`Topic ${topicId} not found`);
  }

  const userPrompt = buildReExplainUserPrompt({
    topicTitle: row.topicTitle,
    chapterTitle: row.chapterTitle ?? undefined,
    subjectName: row.subjectName ?? undefined,
    level,
    previousApproaches,
    studentQuestion,
    language,
  });

  // A single card can carry a detailed inline SVG, which alone can exceed
  // 2k tokens. Give enough headroom that one card is never truncated.
  const maxTokens = 4000;

  // Use a cheaper model for single-card real-time work (Haiku).
  // Fall back to Sonnet automatically through the provider chain if needed.
  const result = await aiChat(
    userPrompt,
    {
      model: AI_MODELS.BULK,
      systemPrompt: EXPLAINER_SYSTEM_PROMPT,
      temperature: 0.6,
      maxTokens,
      language,
    },
    {
      pipelineStage: studentQuestion
        ? "explainer_answer_generate"
        : "explainer_reexplain_generate",
      entityType: "topic",
      entityId: topicId,
    }
  );

  if (result.outputTokens >= maxTokens) {
    throw new Error(
      `Re-explanation hit the ${maxTokens}-token output cap (likely truncated).`
    );
  }

  const raw = extractJson(result.content);
  const parsed = ExplainerDeckSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `AI returned invalid card JSON: ${parsed.error.issues[0]?.message ?? "unknown"}`
    );
  }
  const card = parsed.data.cards[0];
  if (!card || !cardHasVisual(card)) {
    throw new Error("AI returned a text-only card — visual required");
  }

  return {
    card: { ...card, isPreGenerated: false },
    costUsd: result.costUsd,
  };
}
