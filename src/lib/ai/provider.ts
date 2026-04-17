/**
 * Centralized AI provider — all AI calls go through here.
 * Supports: Anthropic Claude (primary), Google Gemini, Mistral, Perplexity, OpenAI (fallback)
 * Features: token counting, cost logging, retry on transient errors,
 *           language-based routing (Indic → Gemini), auto-failover chains,
 *           per-provider rate limiting via Redis.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam, ContentBlockParam } from "@anthropic-ai/sdk/resources/messages";
import { GoogleGenAI } from "@google/genai";
import { Mistral } from "@mistralai/mistralai";
import OpenAI from "openai";
import { db } from "@/db";
import { contentPipelineLogs } from "@/db/schema/system";
import { getRedisConnection } from "@/lib/redis";

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------
export const AI_MODELS = {
  // Anthropic — primary for complex tasks (Claude Sonnet 4.6, latest)
  PRIMARY: "claude-sonnet-4-6",
  BULK: "claude-haiku-4-5-20251001",

  // Google Gemini — multimodal, strong multilingual (Hindi, Tamil, Malayalam, etc.)
  GEMINI_PRO: "gemini-2.5-pro",
  GEMINI_FLASH: "gemini-2.5-flash",
  GEMINI_FLASH_LITE: "gemini-2.5-flash-lite",

  // Google Gemma — strong on handwritten OCR (via Google AI Studio, same endpoint as Gemini)
  GEMMA_3_27B: "gemma-3-27b-it",
  GEMMA_3_12B: "gemma-3-12b-it",

  // Mistral — alternative complex tasks, multilingual
  MISTRAL_LARGE: "mistral-large-latest",
  MISTRAL_SMALL: "mistral-small-latest",

  // Perplexity — web-grounded search tasks
  PERPLEXITY_SONAR: "sonar",
  PERPLEXITY_SONAR_PRO: "sonar-pro",

  // OpenAI — legacy fallback
  FALLBACK: "gpt-4o",
  FALLBACK_MINI: "gpt-4o-mini",
} as const;

export type AIModel = (typeof AI_MODELS)[keyof typeof AI_MODELS];

type Provider = "anthropic" | "gemini" | "mistral" | "perplexity" | "openai";

// ---------------------------------------------------------------------------
// Public provider name type — used by callers for explicit routing
// ---------------------------------------------------------------------------
export type AIProviderName = "anthropic" | "gemini" | "mistral" | "openai" | "perplexity" | "sarvam";

/** Indic language codes that trigger Gemini routing for OCR/vision tasks */
export const INDIC_LANGUAGES = ["hi", "ml", "ta", "te", "kn", "mr", "gu", "bn"] as const;
export type IndicLanguage = (typeof INDIC_LANGUAGES)[number];
export type SupportedLanguage = "en" | IndicLanguage;

/** Check if a language code is an Indic language */
export function isIndicLanguage(lang?: string): lang is IndicLanguage {
  return !!lang && (INDIC_LANGUAGES as readonly string[]).includes(lang);
}

// ---------------------------------------------------------------------------
// Sarvam Vision placeholder — REST-based, implement later
// ---------------------------------------------------------------------------
export interface SarvamVisionOptions {
  apiKey: string;
  model?: string;
  language?: string;
}

async function callSarvamVision(
  _imageBase64: string,
  _prompt: string,
  _options?: SarvamVisionOptions
): Promise<AICallResult> {
  // TODO: Implement Sarvam Vision REST API integration
  // Sarvam (sarvam.ai) specializes in Indic OCR with 91-95% word accuracy
  // on Hindi, Tamil, Bengali, Marathi, Malayalam
  throw new AIProviderError(
    "Sarvam Vision provider not yet implemented",
    501,
    "sarvam",
    false
  );
}

// ---------------------------------------------------------------------------
// Rate limiting per provider
// ---------------------------------------------------------------------------
const RATE_LIMITS: Record<string, number> = {
  anthropic: 60,
  gemini: 60,
  openai: 60,
  mistral: 60,
  perplexity: 30,
  sarvam: 30,
};

/**
 * Check if provider is approaching its rate limit.
 * Key format: padvik:rate:{provider}:{minute}
 */
async function checkRateLimit(provider: string): Promise<boolean> {
  try {
    const redis = getRedisConnection();
    const minute = Math.floor(Date.now() / 60000);
    const key = `padvik:rate:${provider}:${minute}`;
    const count = await redis.get(key);
    const limit = RATE_LIMITS[provider] ?? 60;
    return (parseInt(count ?? "0", 10)) >= limit;
  } catch {
    // If Redis is unavailable, don't block — proceed without rate limiting
    return false;
  }
}

/** Increment the rate counter for a provider */
async function incrementRateCount(provider: string): Promise<void> {
  try {
    const redis = getRedisConnection();
    const minute = Math.floor(Date.now() / 60000);
    const key = `padvik:rate:${provider}:${minute}`;
    await redis.multi().incr(key).expire(key, 120).exec();
  } catch {
    // Non-critical — silently ignore Redis failures
  }
}

// ---------------------------------------------------------------------------
// Provider failover chains
// ---------------------------------------------------------------------------

/** Get failover chain of models based on language context */
function getFailoverChain(language?: string): AIModel[] {
  if (isIndicLanguage(language)) {
    // Indic tasks: Gemini → Claude → OpenAI (Sarvam handled separately for vision)
    return [
      AI_MODELS.GEMINI_PRO,
      AI_MODELS.PRIMARY,
      AI_MODELS.FALLBACK,
    ];
  }
  // English/default: Claude → OpenAI → Gemini
  return [
    AI_MODELS.PRIMARY,
    AI_MODELS.FALLBACK,
    AI_MODELS.GEMINI_PRO,
  ];
}

/** Map AIProviderName to a default model */
function providerNameToModel(name: AIProviderName): AIModel {
  switch (name) {
    case "anthropic": return AI_MODELS.PRIMARY;
    case "gemini": return AI_MODELS.GEMINI_PRO;
    case "mistral": return AI_MODELS.MISTRAL_LARGE;
    case "openai": return AI_MODELS.FALLBACK;
    case "perplexity": return AI_MODELS.PERPLEXITY_SONAR;
    case "sarvam": return AI_MODELS.GEMINI_PRO; // placeholder — Sarvam has no model enum yet
  }
}

/** Resolve which model to use based on optional provider, language, and existing model */
function resolveRoutedModel(
  options: AICallOptions,
  isVisionTask: boolean
): AIModel {
  // 1. Explicit provider override takes priority
  if (options.provider) {
    return providerNameToModel(options.provider);
  }

  // 2. If model already specified, use it (existing behavior)
  if (options.model) {
    return options.model;
  }

  // 3. Language-based routing for vision/OCR tasks with Indic languages
  if (isVisionTask && isIndicLanguage(options.language)) {
    return AI_MODELS.GEMINI_PRO;
  }

  // 4. Default — existing behavior (PRIMARY = Claude)
  return AI_MODELS.PRIMARY;
}

function getProvider(model: AIModel): Provider {
  if (model.startsWith("claude-")) return "anthropic";
  // Both Gemini and Gemma use the Google AI Studio API (same endpoint)
  if (model.startsWith("gemini-") || model.startsWith("gemma-")) return "gemini";
  if (model.startsWith("mistral-") || model.startsWith("open-mistral") || model.startsWith("codestral")) return "mistral";
  if (model.startsWith("sonar") || model.startsWith("pplx-")) return "perplexity";
  return "openai";
}

// Cost per 1M tokens (USD) — approximate, update as pricing changes
const COST_PER_1M: Record<string, { input: number; output: number }> = {
  // Anthropic
  "claude-sonnet-4-6": { input: 3.0, output: 15.0 },
  "claude-sonnet-4-20250514": { input: 3.0, output: 15.0 },
  "claude-haiku-4-5-20251001": { input: 0.8, output: 4.0 },
  // Google Gemini
  "gemini-2.5-pro": { input: 1.25, output: 10.0 },
  "gemini-2.5-flash": { input: 0.3, output: 2.5 },
  "gemini-2.5-flash-lite": { input: 0.1, output: 0.4 },
  // Google Gemma (free via AI Studio)
  "gemma-3-27b-it": { input: 0.0, output: 0.0 },
  "gemma-3-12b-it": { input: 0.0, output: 0.0 },
  // Mistral
  "mistral-large-latest": { input: 2.0, output: 6.0 },
  "mistral-small-latest": { input: 0.1, output: 0.3 },
  // Perplexity
  "sonar": { input: 1.0, output: 1.0 },
  "sonar-pro": { input: 3.0, output: 15.0 },
  // OpenAI
  "gpt-4o": { input: 2.5, output: 10.0 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
};

const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 2000;

// ---------------------------------------------------------------------------
// Client singletons
// ---------------------------------------------------------------------------
let _anthropic: Anthropic | null = null;
let _gemini: GoogleGenAI | null = null;
let _mistral: Mistral | null = null;
let _perplexity: OpenAI | null = null;
let _openai: OpenAI | null = null;

function getAnthropic(): Anthropic {
  if (!_anthropic) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
    _anthropic = new Anthropic({ apiKey });
  }
  return _anthropic;
}

function getGemini(): GoogleGenAI {
  if (!_gemini) {
    const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    if (!apiKey) throw new Error("GOOGLE_GENERATIVE_AI_API_KEY is not set");
    _gemini = new GoogleGenAI({ apiKey });
  }
  return _gemini;
}

function getMistral(): Mistral {
  if (!_mistral) {
    const apiKey = process.env.MISTRAL_API_KEY;
    if (!apiKey) throw new Error("MISTRAL_API_KEY is not set");
    _mistral = new Mistral({ apiKey });
  }
  return _mistral;
}

function getPerplexity(): OpenAI {
  if (!_perplexity) {
    const apiKey = process.env.PERPLEXITY_API_KEY;
    if (!apiKey) throw new Error("PERPLEXITY_API_KEY is not set");
    _perplexity = new OpenAI({
      apiKey,
      baseURL: "https://api.perplexity.ai",
    });
  }
  return _perplexity;
}

function getOpenAI(): OpenAI {
  if (!_openai) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
    _openai = new OpenAI({ apiKey });
  }
  return _openai;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface AICallOptions {
  model?: AIModel;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  /** Force JSON output (used by Gemini responseMimeType) */
  jsonOutput?: boolean;
  /** Explicit provider override — routes to this provider regardless of model */
  provider?: AIProviderName;
  /** Language hint for routing — Indic languages route to Gemini for OCR/vision tasks */
  language?: string;
}

export interface AICallResult {
  content: string;
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  durationMs: number;
  language?: string;
}

/** Error class with HTTP status for provider failures */
export class AIProviderError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly provider: string,
    public readonly isRetryable: boolean
  ) {
    super(message);
    this.name = "AIProviderError";
  }
}

/** Check if an error is an auth/quota failure (401/403) that needs provider switch */
export function isAuthError(err: unknown): boolean {
  if (err instanceof AIProviderError) return err.status === 401 || err.status === 403;
  const status = (err as { status?: number }).status;
  if (status === 401 || status === 403) return true;
  // Gemini SDK throws errors with message containing auth/billing keywords
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return msg.includes("api key") || msg.includes("authentication") || msg.includes("permission denied");
}

/** Check if an error is a quota/rate limit/billing error */
export function isQuotaError(err: unknown): boolean {
  if (err instanceof AIProviderError) return err.status === 429;
  const status = (err as { status?: number }).status;
  if (status === 429) return true;
  // Gemini SDK billing/quota errors
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes("quota") ||
    msg.includes("rate limit") ||
    msg.includes("resource exhausted") ||
    msg.includes("billing") ||
    msg.includes("exceeded") ||
    msg.includes("resource_exhausted") ||
    msg.includes("429")
  );
}

export interface AILogContext {
  pipelineStage: string;
  entityType: string;
  entityId: number;
}

// Simple text message for non-Anthropic providers
interface SimpleMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

// ---------------------------------------------------------------------------
// Provider-specific callers
// ---------------------------------------------------------------------------

async function callAnthropic(
  messages: MessageParam[],
  options: AICallOptions
): Promise<AICallResult> {
  const model = options.model ?? AI_MODELS.PRIMARY;
  const client = getAnthropic();
  const start = Date.now();
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await client.messages.create({
        model,
        max_tokens: options.maxTokens ?? 4096,
        temperature: options.temperature ?? 0.3,
        ...(options.systemPrompt ? { system: options.systemPrompt } : {}),
        messages,
      });

      const content =
        response.content[0].type === "text" ? response.content[0].text : "";

      return {
        content,
        model,
        provider: "anthropic",
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        costUsd: calculateCost(model, response.usage.input_tokens, response.usage.output_tokens),
        durationMs: Date.now() - start,
      };
    } catch (err) {
      lastError = err;
      const status = (err as { status?: number }).status;
      if (status && [500, 529, 429].includes(status) && attempt < MAX_RETRIES) {
        await sleep(RETRY_BASE_DELAY_MS * Math.pow(2, attempt));
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

async function callGemini(
  messages: SimpleMessage[],
  options: AICallOptions
): Promise<AICallResult> {
  const model = options.model ?? AI_MODELS.GEMINI_PRO;
  const client = getGemini();
  const start = Date.now();
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      // Build contents array from messages
      const contents = messages.map((m) => ({
        role: m.role === "assistant" ? ("model" as const) : ("user" as const),
        parts: [{ text: typeof m.content === "string" ? m.content : JSON.stringify(m.content) }],
      }));

      // Enable thinking for Pro models (they require it for quality output)
      const isProModel = model.includes("-pro");

      const requestedMaxTokens = options.maxTokens ?? 8192;
      const response = await client.models.generateContent({
        model,
        contents,
        config: {
          systemInstruction: options.systemPrompt ?? undefined,
          temperature: options.temperature ?? 0.3,
          maxOutputTokens: requestedMaxTokens,
          ...(isProModel ? { thinkingConfig: { thinkingBudget: Math.min(requestedMaxTokens, 8192) } } : {}),
          ...(options.jsonOutput ? { responseMimeType: "application/json" } : {}),
        },
      });

      const content = response.text ?? "";
      const inputTokens = response.usageMetadata?.promptTokenCount ?? 0;
      const outputTokens = response.usageMetadata?.candidatesTokenCount ?? 0;

      // Log if output was likely truncated
      if (outputTokens > 0 && outputTokens >= requestedMaxTokens * 0.95) {
        console.warn(`[Gemini] WARNING: Output may be truncated — used ${outputTokens}/${requestedMaxTokens} tokens. Consider increasing maxTokens.`);
      }

      return {
        content,
        model,
        provider: "gemini",
        inputTokens,
        outputTokens,
        costUsd: calculateCost(model, inputTokens, outputTokens),
        durationMs: Date.now() - start,
      };
    } catch (err) {
      lastError = err;
      const status = (err as { status?: number }).status;
      if (status && [500, 503, 429].includes(status) && attempt < MAX_RETRIES) {
        await sleep(RETRY_BASE_DELAY_MS * Math.pow(2, attempt));
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

async function callMistral(
  messages: SimpleMessage[],
  options: AICallOptions
): Promise<AICallResult> {
  const model = options.model ?? AI_MODELS.MISTRAL_LARGE;
  const client = getMistral();
  const start = Date.now();
  let lastError: unknown;

  const mistralMessages: SimpleMessage[] = options.systemPrompt
    ? [{ role: "system", content: options.systemPrompt }, ...messages]
    : messages;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await client.chat.complete({
        model,
        messages: mistralMessages,
        temperature: options.temperature ?? 0.3,
        maxTokens: options.maxTokens ?? 4096,
      });

      const choice = response.choices?.[0];
      const rawContent = choice?.message?.content ?? "";
      const content = typeof rawContent === "string" ? rawContent : "";
      const inputTokens = response.usage?.promptTokens ?? 0;
      const outputTokens = response.usage?.completionTokens ?? 0;

      return {
        content,
        model,
        provider: "mistral",
        inputTokens,
        outputTokens,
        costUsd: calculateCost(model, inputTokens, outputTokens),
        durationMs: Date.now() - start,
      };
    } catch (err) {
      lastError = err;
      const status = (err as { statusCode?: number }).statusCode;
      if (status && [500, 503, 429].includes(status) && attempt < MAX_RETRIES) {
        await sleep(RETRY_BASE_DELAY_MS * Math.pow(2, attempt));
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

async function callOpenAICompatible(
  client: OpenAI,
  messages: SimpleMessage[],
  options: AICallOptions,
  providerName: string = "openai"
): Promise<AICallResult> {
  const model = options.model ?? AI_MODELS.FALLBACK;
  const start = Date.now();
  let lastError: unknown;

  const fullMessages: SimpleMessage[] = options.systemPrompt
    ? [{ role: "system", content: options.systemPrompt }, ...messages]
    : messages;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await client.chat.completions.create({
        model,
        messages: fullMessages,
        temperature: options.temperature ?? 0.3,
        max_tokens: options.maxTokens ?? 4096,
      });

      const content = response.choices[0]?.message?.content ?? "";
      const inputTokens = response.usage?.prompt_tokens ?? 0;
      const outputTokens = response.usage?.completion_tokens ?? 0;

      return {
        content,
        model,
        provider: providerName,
        inputTokens,
        outputTokens,
        costUsd: calculateCost(model, inputTokens, outputTokens),
        durationMs: Date.now() - start,
      };
    } catch (err) {
      lastError = err;
      const status = (err as { status?: number }).status;
      if (status && [500, 503, 429].includes(status) && attempt < MAX_RETRIES) {
        await sleep(RETRY_BASE_DELAY_MS * Math.pow(2, attempt));
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

function toSimpleMessages(messages: MessageParam[]): SimpleMessage[] {
  return messages.map((m) => ({
    role: m.role as "user" | "assistant",
    content: typeof m.content === "string"
      ? m.content
      : (m.content as Array<{ type: string; text?: string }>)
          .filter((b) => b.type === "text")
          .map((b) => b.text ?? "")
          .join("\n"),
  }));
}

async function callProvider(
  messages: MessageParam[],
  options: AICallOptions
): Promise<AICallResult> {
  const model = options.model ?? AI_MODELS.PRIMARY;
  const provider = getProvider(model);

  // Track rate limit
  await incrementRateCount(provider);

  switch (provider) {
    case "anthropic":
      return callAnthropic(messages, options);

    case "gemini":
      return callGemini(toSimpleMessages(messages), options);

    case "mistral":
      return callMistral(toSimpleMessages(messages), options);

    case "perplexity":
      return callOpenAICompatible(getPerplexity(), toSimpleMessages(messages), options, "perplexity");

    case "openai":
    default:
      return callOpenAICompatible(getOpenAI(), toSimpleMessages(messages), options, "openai");
  }
}

/**
 * Call provider with auto-failover — tries the primary model, then falls back
 * through the chain if the provider returns 429/500/timeout or is rate-limited.
 */
async function callProviderWithFailover(
  messages: MessageParam[],
  options: AICallOptions,
  isVisionTask: boolean = false
): Promise<AICallResult> {
  const primaryModel = resolveRoutedModel(options, isVisionTask);
  const failoverChain = getFailoverChain(options.language);

  // Build ordered model list: primary first, then failover chain (deduped)
  const modelsToTry = [primaryModel, ...failoverChain.filter((m) => m !== primaryModel)];

  let lastError: unknown;

  for (const model of modelsToTry) {
    const provider = getProvider(model);

    // Check rate limit before attempting
    const isLimited = await checkRateLimit(provider);
    if (isLimited) {
      console.warn(`[AI] Rate limit near for ${provider}, skipping to next provider`);
      continue;
    }

    try {
      const result = await callProvider(messages, { ...options, model });
      result.language = options.language;
      return result;
    } catch (err) {
      lastError = err;
      const status = (err as { status?: number }).status ?? (err as { statusCode?: number }).statusCode;
      const isTransient = status === 429 || status === 500 || status === 503 || status === 529;

      if (isTransient || isAuthError(err) || isQuotaError(err)) {
        console.warn(`[AI] ${provider}/${model} failed (status=${status}), trying next provider...`);
        continue;
      }
      // Non-transient error — don't try other providers
      throw err;
    }
  }

  throw lastError ?? new AIProviderError("All providers failed", 503, "all", true);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Send a text message to the configured AI provider and get a response.
 * Supports optional provider and language params for routing.
 * Existing callers with no provider/language work exactly as before.
 */
export async function aiChat(
  userMessage: string,
  options: AICallOptions = {},
  logContext?: AILogContext
): Promise<AICallResult> {
  // Use failover if provider or language is specified; otherwise keep original direct path
  const useFailover = !!(options.provider || options.language);
  const result = useFailover
    ? await callProviderWithFailover([{ role: "user", content: userMessage }], options, false)
    : await callProvider([{ role: "user", content: userMessage }], options);

  if (logContext) {
    await logAICall(logContext, result).catch((err) =>
      console.error("Failed to log AI call:", err)
    );
  }

  return result;
}

/**
 * Send a message with an image (base64) to AI Vision.
 * Supports language-based routing: Indic languages → Gemini, English → Claude.
 * Vision is supported on Anthropic and Gemini. Explicit provider override available.
 */
export async function aiVision(
  userMessage: string,
  imageBase64: string,
  mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif" = "image/png",
  options: AICallOptions = {},
  logContext?: AILogContext
): Promise<AICallResult> {
  // Resolve the model based on provider/language routing (vision task = true)
  const routedModel = resolveRoutedModel(options, true);
  const model = routedModel;
  const provider = getProvider(model);

  // Build vision-capable failover chain for retries
  const visionModels = isIndicLanguage(options.language)
    ? [AI_MODELS.GEMINI_PRO, AI_MODELS.PRIMARY] // Indic: Gemini first
    : [AI_MODELS.PRIMARY, AI_MODELS.GEMINI_PRO]; // English: Claude first

  // Ensure the routed model is first
  const modelsToTry = [model, ...visionModels.filter((m) => m !== model)];

  let lastError: unknown;
  let result: AICallResult | undefined;

  for (const tryModel of modelsToTry) {
    const tryProvider = getProvider(tryModel);

    // Check rate limit
    const isLimited = await checkRateLimit(tryProvider);
    if (isLimited && tryModel !== modelsToTry[modelsToTry.length - 1]) {
      console.warn(`[AI Vision] Rate limit near for ${tryProvider}, skipping to next`);
      continue;
    }

    try {
      await incrementRateCount(tryProvider);

      if (tryProvider === "gemini") {
        const start = Date.now();
        const client = getGemini();
        const isProModel = tryModel.includes("-pro");
        const isGemma = tryModel.startsWith("gemma-");

        const response = await client.models.generateContent({
          model: tryModel,
          contents: [
            {
              role: "user" as const,
              parts: [
                { inlineData: { mimeType: mediaType, data: imageBase64 } },
                { text: userMessage },
              ],
            },
          ],
          config: {
            // Gemma doesn't support systemInstruction separately — embed in user message if needed
            ...(isGemma ? {} : { systemInstruction: options.systemPrompt ?? undefined }),
            temperature: options.temperature ?? 0.3,
            maxOutputTokens: options.maxTokens ?? 8192,
            // thinkingConfig is Gemini Pro only — not supported by Gemma or Flash
            ...(isProModel && !isGemma ? { thinkingConfig: { thinkingBudget: 4096 } } : {}),
            // responseMimeType (JSON output) not supported by Gemma
            ...(options.jsonOutput && !isGemma ? { responseMimeType: "application/json" } : {}),
          },
        });

        const text = response.text ?? "";
        const inputTokens = response.usageMetadata?.promptTokenCount ?? 0;
        const outputTokens = response.usageMetadata?.candidatesTokenCount ?? 0;

        // If response is empty, treat as failure so failover kicks in
        // (some Gemma models don't support vision — they silently return empty)
        if (!text.trim()) {
          throw new Error(
            `Empty response from ${tryModel} — model may not support vision or image input`
          );
        }

        result = {
          content: text,
          model: tryModel,
          provider: "gemini",
          inputTokens,
          outputTokens,
          costUsd: calculateCost(tryModel, inputTokens, outputTokens),
          durationMs: Date.now() - start,
          language: options.language,
        };
      } else {
        // Anthropic vision
        const content: ContentBlockParam[] = [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType, data: imageBase64 },
          },
          { type: "text", text: userMessage },
        ];

        result = await callAnthropic(
          [{ role: "user", content }],
          { ...options, model: tryModel, maxTokens: options.maxTokens ?? 8192 }
        );
        result.language = options.language;
      }
      break; // Success — exit retry loop
    } catch (err) {
      lastError = err;
      const status = (err as { status?: number }).status;
      const msg = (err as Error)?.message ?? "";
      const isTransient = status === 429 || status === 500 || status === 503;
      // Also failover on 400/404 (model not found / invalid model) and missing keys
      const isModelNotFound = status === 404 || status === 400 ||
        /not found|does not exist|invalid model|unsupported/i.test(msg);
      // Failover on empty responses (some models don't support vision)
      const isEmptyResponse = /empty response|may not support vision/i.test(msg);
      if (isTransient || isModelNotFound || isEmptyResponse || isAuthError(err) || isQuotaError(err)) {
        console.warn(`[AI Vision] ${tryProvider}/${tryModel} failed (${status ?? "?"}: ${msg.substring(0, 100)}), trying next...`);
        continue;
      }
      throw err;
    }
  }

  if (!result) {
    throw lastError ?? new AIProviderError("All vision providers failed", 503, "all", true);
  }

  if (logContext) {
    await logAICall(logContext, result).catch((err) =>
      console.error("Failed to log AI call:", err)
    );
  }

  return result;
}

/**
 * Send a PDF document directly to Gemini Vision for parsing.
 * Gemini 2.5 natively supports PDF input — it can see all pages, diagrams, and figures.
 * This is the preferred method for PDFs with images/diagrams.
 */
export async function aiPdfVision(
  userMessage: string,
  pdfBase64: string,
  options: AICallOptions = {},
  logContext?: AILogContext
): Promise<AICallResult> {
  const model = options.model ?? AI_MODELS.GEMINI_FLASH;
  const client = getGemini();
  const start = Date.now();
  const isProModel = model.includes("-pro");
  const requestedMaxTokens = options.maxTokens ?? 32768;

  const response = await client.models.generateContent({
    model,
    contents: [
      {
        role: "user" as const,
        parts: [
          { inlineData: { mimeType: "application/pdf", data: pdfBase64 } },
          { text: userMessage },
        ],
      },
    ],
    config: {
      systemInstruction: options.systemPrompt ?? undefined,
      temperature: options.temperature ?? 0.1,
      maxOutputTokens: requestedMaxTokens,
      ...(isProModel ? { thinkingConfig: { thinkingBudget: Math.min(requestedMaxTokens, 8192) } } : {}),
      ...(options.jsonOutput ? { responseMimeType: "application/json" } : {}),
    },
  });

  const content = response.text ?? "";
  const inputTokens = response.usageMetadata?.promptTokenCount ?? 0;
  const outputTokens = response.usageMetadata?.candidatesTokenCount ?? 0;

  if (outputTokens > 0 && outputTokens >= requestedMaxTokens * 0.95) {
    console.warn(`[GeminiPDF] WARNING: Output may be truncated — used ${outputTokens}/${requestedMaxTokens} tokens.`);
  }

  const result: AICallResult = {
    content,
    model,
    provider: "gemini",
    inputTokens,
    outputTokens,
    costUsd: calculateCost(model, inputTokens, outputTokens),
    durationMs: Date.now() - start,
    language: options.language,
  };

  if (logContext) {
    await logAICall(logContext, result).catch((err) =>
      console.error("Failed to log AI call:", err)
    );
  }

  return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function calculateCost(model: string, inputTokens: number, outputTokens: number): number {
  const rates = COST_PER_1M[model];
  if (!rates) return 0;
  return (inputTokens * rates.input + outputTokens * rates.output) / 1_000_000;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function logAICall(context: AILogContext, result: AICallResult): Promise<void> {
  await db.insert(contentPipelineLogs).values({
    pipelineStage: context.pipelineStage,
    entityType: context.entityType,
    entityId: context.entityId,
    status: "completed",
    aiModelUsed: result.model,
    aiTokensUsed: result.inputTokens + result.outputTokens,
    processingTimeMs: result.durationMs,
    aiProvider: result.provider ?? null,
    language: result.language ?? null,
    outputData: {
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      costUsd: result.costUsd,
      provider: result.provider,
      language: result.language,
    },
  });
}
