/**
 * Parse questions from uploaded images using AI Vision.
 */
import { aiVision } from "@/lib/ai/provider";
import {
  SYSTEM_PROMPT,
  parseResponse,
  config as promptConfig,
  type QuestionPaperParseResult,
} from "@/lib/ai/prompts/question-paper-parser";

export interface ImageInput {
  base64: string;
  mediaType: "image/jpeg" | "image/png" | "image/webp";
}

export async function parseQuestionsFromImage(
  image: ImageInput,
  context?: {
    boardCode?: string;
    grade?: number;
    subjectHint?: string;
  }
): Promise<QuestionPaperParseResult> {
  const userPrompt = [
    "Extract ALL questions from the following image of a question paper.",
    context?.boardCode ? `Board: ${context.boardCode}` : "",
    context?.grade ? `Class/Grade: ${context.grade}` : "",
    context?.subjectHint ? `Subject: ${context.subjectHint}` : "",
    "",
    "Parse every question into the structured JSON format with all fields.",
  ]
    .filter(Boolean)
    .join("\n");

  const visionResult = await aiVision(
    userPrompt,
    image.base64,
    image.mediaType,
    {
      model: promptConfig.model,
      systemPrompt: SYSTEM_PROMPT,
      temperature: promptConfig.temperature,
      maxTokens: promptConfig.maxTokens,
    }
  );

  return parseResponse(visionResult.content);
}
