/**
 * Per-generator model selection for the auto-content pipeline.
 *
 * Defaults: the highest-quality reasoning model (Opus 4.8) for the content
 * students read (notes, question sets); the balanced model (Sonnet 4.6) for
 * the audio narration script; and the cheap model (Haiku 4.5) for the video
 * re-rank (a ranking task). Each is overridable via env without code changes.
 *
 * Reads are lazy (inside functions) because workers load .env *after* module
 * import — a module-level read would miss env overrides.
 */
import { AI_MODELS, type AIModel } from "@/lib/ai/provider";

export type AutoContentKind =
  | "text_note"
  | "question_set"
  | "audio_explainer"
  | "video_rerank";

type Effort = "low" | "medium" | "high" | "xhigh" | "max";

const MODEL_CONFIG: Record<AutoContentKind, { env: string; fallback: AIModel }> = {
  text_note: { env: "AUTO_CONTENT_TEXT_MODEL", fallback: AI_MODELS.REASONING },
  question_set: { env: "AUTO_CONTENT_QUESTION_MODEL", fallback: AI_MODELS.REASONING },
  audio_explainer: { env: "AUTO_CONTENT_AUDIO_MODEL", fallback: AI_MODELS.PRIMARY },
  video_rerank: { env: "AUTO_CONTENT_VIDEO_RANK_MODEL", fallback: AI_MODELS.BULK },
};

/** Resolve the model for a generator (env override → sensible default). */
export function getAutoContentModel(kind: AutoContentKind): AIModel {
  const { env, fallback } = MODEL_CONFIG[kind];
  const v = process.env[env];
  return v && v.trim() ? (v.trim() as AIModel) : fallback;
}

/**
 * Resolve the model to use, preferring an explicit per-job override (an
 * admin-selected model) over the configured default.
 */
export function resolveAutoContentModel(kind: AutoContentKind, override?: string): AIModel {
  return override && override.trim() ? (override.trim() as AIModel) : getAutoContentModel(kind);
}

/** Reasoning effort for Opus-tier generations (env override → "medium"). */
export function getAutoContentEffort(): Effort {
  const v = process.env.AUTO_CONTENT_EFFORT?.trim();
  const allowed: Effort[] = ["low", "medium", "high", "xhigh", "max"];
  return v && (allowed as string[]).includes(v) ? (v as Effort) : "medium";
}
