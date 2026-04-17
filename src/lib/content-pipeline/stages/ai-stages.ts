/**
 * Pipeline stages: AI-powered content analysis.
 *
 * Content-type-aware AI stages:
 * - ai_summarize:     2-3 sentence summary (skipped for images)
 * - ai_tag:           5-8 topic tags (images use AI Vision)
 * - ai_quality_check: 0-1 quality score
 * - ai_detect_language: ISO 639-1 language code (kept for backward compat)
 */

import { aiChat, aiVision, AI_MODELS } from "@/lib/ai/provider";
import type { PipelineContext } from "../types";
import { buildAnalysisText, getFileBuffer } from "./helpers";

/** Use Haiku for all pipeline AI calls — cheap and fast */
const PIPELINE_MODEL = AI_MODELS.BULK;

// ---------------------------------------------------------------------------
// AI Summarize
// ---------------------------------------------------------------------------

export async function handleAiSummarize(ctx: PipelineContext): Promise<void> {
  const analysisText = buildAnalysisText(ctx, 2000);

  // Skip for images (they don't get text summaries)
  if (ctx.content.contentType === "image") return;

  // Need at least some text to summarize
  if (analysisText.length < 10) return;

  const summaryResult = await aiChat(
    `Summarize this educational content in 2-3 concise sentences for a student dashboard card. Focus on what students will learn.\n\nTitle: ${ctx.content.title}\nContent: ${analysisText}`,
    { model: PIPELINE_MODEL, temperature: 0.2, maxTokens: 200 }
  );
  ctx.result.aiSummary = summaryResult.content.trim();
}

// ---------------------------------------------------------------------------
// AI Tag
// ---------------------------------------------------------------------------

export async function handleAiTag(ctx: PipelineContext): Promise<void> {
  // For images: use AI Vision to extract topic tags from the image itself
  if (ctx.content.contentType === "image" && ctx.content.mediaUrl) {
    await tagImageWithVision(ctx);
    return;
  }

  // For other types: use text-based tagging
  const analysisText = buildAnalysisText(ctx, 1500);
  if (analysisText.length < 10) return;

  const tagResult = await aiChat(
    `Extract 5-8 educational topic tags from this content. Return ONLY a JSON array of strings, no other text.\n\nTitle: ${ctx.content.title}\nSubject context: ${ctx.content.contentType}\nContent: ${analysisText}`,
    { model: PIPELINE_MODEL, temperature: 0.1, maxTokens: 200 }
  );

  ctx.result.aiTags = parseTagsFromResponse(tagResult.content);
}

/** Use AI Vision to extract topic tags from an image */
async function tagImageWithVision(ctx: PipelineContext): Promise<void> {
  const mediaUrl = ctx.content.mediaUrl!;

  try {
    const buffer = await getFileBuffer(mediaUrl);
    const base64 = buffer.toString("base64");

    // Determine MIME type for vision API
    const mimeType = (ctx.content.originalFileType ?? "image/jpeg") as
      | "image/png"
      | "image/jpeg"
      | "image/webp"
      | "image/gif";

    const tagResult = await aiVision(
      `Analyze this educational image/diagram. Extract 5-8 topic tags describing the educational concepts shown. Return ONLY a JSON array of strings, no other text.\n\nContext: Title is "${ctx.content.title}"`,
      base64,
      mimeType,
      { model: PIPELINE_MODEL, temperature: 0.1, maxTokens: 200 }
    );

    ctx.result.aiTags = parseTagsFromResponse(tagResult.content);
  } catch (err) {
    console.warn(
      `[pipeline] Image vision tagging failed for content ${ctx.contentId}:`,
      err instanceof Error ? err.message : err
    );
    // Fall back to text-based tagging from title/description
    const analysisText = buildAnalysisText(ctx, 500);
    if (analysisText.length >= 10) {
      const tagResult = await aiChat(
        `Extract 5-8 educational topic tags from this content title and description. Return ONLY a JSON array of strings.\n\n${analysisText}`,
        { model: PIPELINE_MODEL, temperature: 0.1, maxTokens: 200 }
      );
      ctx.result.aiTags = parseTagsFromResponse(tagResult.content);
    }
  }
}

// ---------------------------------------------------------------------------
// AI Quality Check
// ---------------------------------------------------------------------------

export async function handleAiQualityCheck(ctx: PipelineContext): Promise<void> {
  const contentType = ctx.content.contentType;

  // Different prompt for question sets vs regular content
  const prompt =
    contentType === "question_set"
      ? buildQuestionSetQualityPrompt(ctx)
      : buildContentQualityPrompt(ctx);

  if (!prompt) return;

  const qualityResult = await aiChat(prompt, {
    model: PIPELINE_MODEL,
    temperature: 0.1,
    maxTokens: 150,
  });

  try {
    const jsonMatch = qualityResult.content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (typeof parsed.score === "number") {
        ctx.result.aiQualityScore = Math.min(1, Math.max(0, parsed.score));
      }
    }
  } catch {
    // Default to moderate quality if parsing fails
    ctx.result.aiQualityScore = 0.5;
  }
}

function buildContentQualityPrompt(ctx: PipelineContext): string | null {
  const analysisText = buildAnalysisText(ctx, 1500);
  if (analysisText.length < 10) return null;

  return `Rate this educational content on a scale of 0.0 to 1.0 based on: curriculum relevance, clarity, accuracy, and completeness. Return ONLY a JSON object: {"score": 0.85, "reason": "brief explanation"}\n\nTitle: ${ctx.content.title}\nType: ${ctx.content.contentType}\nContent: ${analysisText}`;
}

function buildQuestionSetQualityPrompt(ctx: PipelineContext): string | null {
  const analysisText = buildAnalysisText(ctx, 2000);
  if (analysisText.length < 10) return null;

  return `Validate this educational question set. Rate 0.0-1.0 on: question clarity, answer correctness, difficulty appropriateness, curriculum alignment. Return ONLY a JSON object: {"score": 0.85, "reason": "brief explanation"}\n\nTitle: ${ctx.content.title}\nContent: ${analysisText}`;
}

// ---------------------------------------------------------------------------
// AI Detect Language (kept for backward compatibility, not in default pipelines)
// ---------------------------------------------------------------------------

export async function handleAiDetectLanguage(ctx: PipelineContext): Promise<void> {
  const analysisText = buildAnalysisText(ctx, 500);
  if (analysisText.length < 10) return;

  const langResult = await aiChat(
    `Detect the primary language of this text. Return ONLY the ISO 639-1 code (e.g., "en", "hi", "ml", "ta", "te", "kn"). No other text.\n\n${analysisText}`,
    { model: PIPELINE_MODEL, temperature: 0, maxTokens: 10 }
  );

  const detectedLang = langResult.content
    .trim()
    .toLowerCase()
    .replace(/[^a-z]/g, "")
    .substring(0, 2);

  if (detectedLang.length === 2) {
    ctx.result.aiLanguage = detectedLang;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse AI response into a tags array, with fallback splitting */
function parseTagsFromResponse(response: string): string[] {
  const raw = response.trim();

  // Try to extract JSON array
  try {
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed)) {
        return parsed.map(String).slice(0, 10);
      }
    }
  } catch {
    // Fall through to comma splitting
  }

  // Fallback: split by comma
  return raw
    .split(",")
    .map((s) => s.trim().replace(/["\[\]]/g, ""))
    .filter(Boolean)
    .slice(0, 10);
}
