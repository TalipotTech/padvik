/**
 * Resolves which AI model to use for syllabus parsing based on the provider choice.
 * Supports all 5 providers + auto-rotation mode for cost optimization.
 */
import { AI_MODELS, type AIModel } from "../ai/provider";
import type { AIProviderChoice } from "../queue";

/** Maps provider choice to the model to use for syllabus parsing */
const PROVIDER_MODEL_MAP: Record<Exclude<AIProviderChoice, "auto">, AIModel> = {
  anthropic: AI_MODELS.PRIMARY,
  gemini: AI_MODELS.GEMINI_PRO,
  mistral: AI_MODELS.MISTRAL_LARGE,
  openai: AI_MODELS.FALLBACK,
  perplexity: AI_MODELS.PERPLEXITY_SONAR,
};

/** For "auto" mode, rotate through these in order (cheapest capable first) */
const AUTO_ROTATION: AIModel[] = [
  AI_MODELS.GEMINI_PRO,      // Gemini 2.0 Flash: $0.10/1M input — strong for structured extraction
  AI_MODELS.FALLBACK_MINI,   // GPT-4o-mini: $0.15/1M input — reliable JSON output
  AI_MODELS.MISTRAL_LARGE,   // Mistral Large: $2.00/1M input — good multilingual
  AI_MODELS.PRIMARY,         // Claude Sonnet: $3.00/1M input — highest quality fallback
];

let autoIndex = 0;

/**
 * Get the AI model to use for the current scrape call.
 * In "auto" mode, rotates through providers starting with the cheapest.
 */
export function resolveModel(provider: AIProviderChoice = "auto"): AIModel {
  if (provider !== "auto") {
    return PROVIDER_MODEL_MAP[provider];
  }

  const model = AUTO_ROTATION[autoIndex % AUTO_ROTATION.length];
  autoIndex++;
  return model;
}

/**
 * Get the model to use, with fallback if the primary choice fails.
 * Returns an array of models to try in order.
 */
export function resolveModelWithFallbacks(
  provider: AIProviderChoice = "auto"
): AIModel[] {
  if (provider === "auto") {
    return [...AUTO_ROTATION];
  }
  const primary = PROVIDER_MODEL_MAP[provider];
  // Always fallback to Claude if primary fails
  if (primary !== AI_MODELS.PRIMARY) {
    return [primary, AI_MODELS.PRIMARY];
  }
  return [primary];
}

/** Human-readable provider name for display */
export function getProviderDisplayName(model: string): string {
  if (model.startsWith("claude-")) return "Anthropic Claude";
  if (model.startsWith("gemini-")) return "Google Gemini";
  if (model.startsWith("mistral-") || model.startsWith("open-mistral")) return "Mistral AI";
  if (model.startsWith("gpt-")) return "OpenAI GPT";
  if (model.startsWith("sonar") || model.startsWith("pplx-")) return "Perplexity";
  return model;
}
