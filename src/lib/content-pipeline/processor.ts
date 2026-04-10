/**
 * Content processing pipeline — runs AI tasks on creator content.
 * Called asynchronously via BullMQ after content upload.
 */

import { db } from "@/db";
import { creatorContent } from "@/db/schema/creators";
import { contentPipelineLogs } from "@/db/schema/system";
import { eq } from "drizzle-orm";
import { aiChat } from "@/lib/ai/provider";
import { AI_MODELS } from "@/lib/ai/provider";
import type { ProcessingResult } from "./types";

// Use Haiku for all pipeline calls — cheap and fast
const PIPELINE_MODEL = AI_MODELS.BULK;

/**
 * Process a creator content item through the AI pipeline.
 * Stages: summarize → tag → quality check → detect language → complete
 */
export async function processCreatorContent(contentId: number): Promise<ProcessingResult> {
  const startTime = Date.now();
  const result: ProcessingResult = {};

  // Load the content
  const [content] = await db
    .select()
    .from(creatorContent)
    .where(eq(creatorContent.id, contentId))
    .limit(1);

  if (!content) {
    throw new Error(`Content ${contentId} not found`);
  }

  // Build the text to analyze — combine title + description + body (first 3000 chars)
  const textParts = [
    content.title,
    content.description || "",
    (content.body || "").substring(0, 3000),
  ].filter(Boolean);
  const analysisText = textParts.join("\n\n");

  if (analysisText.length < 10) {
    // Not enough text to analyze — mark as completed with defaults
    await db.update(creatorContent).set({
      uploadStatus: "completed",
      updatedAt: new Date(),
    }).where(eq(creatorContent.id, contentId));
    return result;
  }

  try {
    // Stage 1: AI Summarize
    try {
      const summaryResult = await aiChat(
        `Summarize this educational content in 2-3 concise sentences for a student dashboard card. Focus on what students will learn.\n\nTitle: ${content.title}\nContent: ${analysisText.substring(0, 2000)}`,
        { model: PIPELINE_MODEL, temperature: 0.2, maxTokens: 200 }
      );
      result.aiSummary = summaryResult.content.trim();
      await logStage(contentId, "ai_summarize", "done", summaryResult.costUsd);
    } catch (err) {
      await logStage(contentId, "ai_summarize", "failed", 0, err);
    }

    // Stage 2: AI Tag
    try {
      const tagResult = await aiChat(
        `Extract 5-8 educational topic tags from this content. Return ONLY a JSON array of strings, no other text.\n\nTitle: ${content.title}\nSubject context: ${content.contentType}\nContent: ${analysisText.substring(0, 1500)}`,
        { model: PIPELINE_MODEL, temperature: 0.1, maxTokens: 200 }
      );
      try {
        const rawTags = tagResult.content.trim();
        // Extract JSON array from response (may have markdown code fences)
        const jsonMatch = rawTags.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          if (Array.isArray(parsed)) {
            result.aiTags = parsed.map(String).slice(0, 10);
          }
        }
      } catch {
        // Fallback: split by comma
        result.aiTags = tagResult.content.split(",").map(s => s.trim().replace(/["\[\]]/g, "")).filter(Boolean).slice(0, 10);
      }
      await logStage(contentId, "ai_tag", "done", tagResult.costUsd);
    } catch (err) {
      await logStage(contentId, "ai_tag", "failed", 0, err);
    }

    // Stage 3: AI Quality Check
    try {
      const qualityResult = await aiChat(
        `Rate this educational content on a scale of 0.0 to 1.0 based on: curriculum relevance, clarity, accuracy, and completeness. Return ONLY a JSON object: {"score": 0.85, "reason": "brief explanation"}\n\nTitle: ${content.title}\nType: ${content.contentType}\nContent: ${analysisText.substring(0, 1500)}`,
        { model: PIPELINE_MODEL, temperature: 0.1, maxTokens: 150 }
      );
      try {
        const jsonMatch = qualityResult.content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          if (typeof parsed.score === "number") {
            result.aiQualityScore = Math.min(1, Math.max(0, parsed.score));
          }
        }
      } catch {
        // Default to moderate quality if parsing fails
        result.aiQualityScore = 0.5;
      }
      await logStage(contentId, "ai_quality_check", "done", qualityResult.costUsd);
    } catch (err) {
      await logStage(contentId, "ai_quality_check", "failed", 0, err);
    }

    // Stage 4: Detect Language
    try {
      const langResult = await aiChat(
        `Detect the primary language of this text. Return ONLY the ISO 639-1 code (e.g., "en", "hi", "ml", "ta", "te", "kn"). No other text.\n\n${analysisText.substring(0, 500)}`,
        { model: PIPELINE_MODEL, temperature: 0, maxTokens: 10 }
      );
      const detectedLang = langResult.content.trim().toLowerCase().replace(/[^a-z]/g, "").substring(0, 2);
      if (detectedLang.length === 2) {
        result.aiLanguage = detectedLang;
      }
      await logStage(contentId, "ai_detect_language", "done", langResult.costUsd);
    } catch (err) {
      await logStage(contentId, "ai_detect_language", "failed", 0, err);
    }

    // Update content with all results
    const updates: Record<string, unknown> = {
      uploadStatus: "completed",
      updatedAt: new Date(),
    };
    if (result.aiSummary) updates.aiSummary = result.aiSummary;
    if (result.aiTags && result.aiTags.length > 0) updates.aiTags = result.aiTags;
    if (result.aiQualityScore !== undefined) updates.aiQualityScore = String(result.aiQualityScore);
    if (result.aiLanguage) updates.aiLanguage = result.aiLanguage;

    // Auto-moderation: flag low quality, auto-approve high quality from verified creators
    if (result.aiQualityScore !== undefined && result.aiQualityScore < 0.3) {
      updates.reviewStatus = "flagged";
    }

    await db.update(creatorContent).set(updates).where(eq(creatorContent.id, contentId));
    await logStage(contentId, "complete", "done", 0);

  } catch (err) {
    // Pipeline failed — mark content as failed
    await db.update(creatorContent).set({
      uploadStatus: "failed",
      updatedAt: new Date(),
    }).where(eq(creatorContent.id, contentId));
    await logStage(contentId, "complete", "failed", 0, err);
    throw err;
  }

  return result;
}

async function logStage(
  contentId: number,
  stage: string,
  status: string,
  costUsd: number,
  error?: unknown
) {
  try {
    await db.insert(contentPipelineLogs).values({
      pipelineStage: `creator_${stage}`,
      entityType: "creator_content",
      entityId: contentId,
      status,
      processingTimeMs: 0,
      aiModelUsed: PIPELINE_MODEL,
      aiProvider: "anthropic",
      errorMessage: error instanceof Error ? error.message : undefined,
    });
  } catch {
    // Don't fail the pipeline because of a logging error
    console.error(`Failed to log pipeline stage ${stage} for content ${contentId}`);
  }
}
