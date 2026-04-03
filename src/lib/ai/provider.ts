/**
 * Centralized AI provider — all AI calls go through here.
 * Supports: Anthropic Claude (primary), Google Gemini, Mistral, Perplexity, OpenAI (fallback)
 * Features: token counting, cost logging, retry on transient errors.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam, ContentBlockParam } from "@anthropic-ai/sdk/resources/messages";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { Mistral } from "@mistralai/mistralai";
import OpenAI from "openai";
import { db } from "@/db";
import { contentPipelineLogs } from "@/db/schema/system";

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------
export const AI_MODELS = {
  // Anthropic — primary for complex tasks
  PRIMARY: "claude-sonnet-4-20250514",
  BULK: "claude-haiku-4-5-20251001",

  // Google Gemini — alternative complex tasks, multimodal
  GEMINI_PRO: "gemini-2.0-flash",
  GEMINI_FLASH: "gemini-2.0-flash-lite",

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

function getProvider(model: AIModel): Provider {
  if (model.startsWith("claude-")) return "anthropic";
  if (model.startsWith("gemini-")) return "gemini";
  if (model.startsWith("mistral-") || model.startsWith("open-mistral") || model.startsWith("codestral")) return "mistral";
  if (model.startsWith("sonar") || model.startsWith("pplx-")) return "perplexity";
  return "openai";
}

// Cost per 1M tokens (USD) — approximate, update as pricing changes
const COST_PER_1M: Record<string, { input: number; output: number }> = {
  // Anthropic
  "claude-sonnet-4-20250514": { input: 3.0, output: 15.0 },
  "claude-haiku-4-5-20251001": { input: 0.8, output: 4.0 },
  // Google Gemini
  "gemini-2.0-flash": { input: 0.1, output: 0.4 },
  "gemini-2.0-flash-lite": { input: 0.075, output: 0.3 },
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
let _gemini: GoogleGenerativeAI | null = null;
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

function getGemini(): GoogleGenerativeAI {
  if (!_gemini) {
    const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    if (!apiKey) throw new Error("GOOGLE_GENERATIVE_AI_API_KEY is not set");
    _gemini = new GoogleGenerativeAI(apiKey);
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
}

export interface AICallResult {
  content: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  durationMs: number;
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
  return status === 401 || status === 403;
}

/** Check if an error is a quota/rate limit error */
export function isQuotaError(err: unknown): boolean {
  if (err instanceof AIProviderError) return err.status === 429;
  const status = (err as { status?: number }).status;
  return status === 429;
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
      const geminiModel = client.getGenerativeModel({
        model,
        ...(options.systemPrompt
          ? { systemInstruction: options.systemPrompt }
          : {}),
        generationConfig: {
          temperature: options.temperature ?? 0.3,
          maxOutputTokens: options.maxTokens ?? 4096,
        },
      });

      // Convert messages to Gemini history + final user message
      const history = messages.slice(0, -1).map((m) => ({
        role: m.role === "assistant" ? ("model" as const) : ("user" as const),
        parts: [{ text: m.content }],
      }));
      const lastMessage = messages[messages.length - 1];

      const chat = geminiModel.startChat({ history });
      const result = await chat.sendMessage(lastMessage.content);
      const response = result.response;
      const content = response.text();

      const inputTokens = response.usageMetadata?.promptTokenCount ?? 0;
      const outputTokens = response.usageMetadata?.candidatesTokenCount ?? 0;

      return {
        content,
        model,
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
  options: AICallOptions
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

  switch (provider) {
    case "anthropic":
      return callAnthropic(messages, options);

    case "gemini":
      return callGemini(toSimpleMessages(messages), options);

    case "mistral":
      return callMistral(toSimpleMessages(messages), options);

    case "perplexity":
      return callOpenAICompatible(getPerplexity(), toSimpleMessages(messages), options);

    case "openai":
    default:
      return callOpenAICompatible(getOpenAI(), toSimpleMessages(messages), options);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Send a text message to the configured AI provider and get a response.
 */
export async function aiChat(
  userMessage: string,
  options: AICallOptions = {},
  logContext?: AILogContext
): Promise<AICallResult> {
  const result = await callProvider(
    [{ role: "user", content: userMessage }],
    options
  );

  if (logContext) {
    await logAICall(logContext, result).catch((err) =>
      console.error("Failed to log AI call:", err)
    );
  }

  return result;
}

/**
 * Send a message with an image (base64) to Claude Vision.
 * Vision is only supported on Anthropic and Gemini — defaults to Anthropic.
 */
export async function aiVision(
  userMessage: string,
  imageBase64: string,
  mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif" = "image/png",
  options: AICallOptions = {},
  logContext?: AILogContext
): Promise<AICallResult> {
  const model = options.model ?? AI_MODELS.PRIMARY;
  const provider = getProvider(model);

  let result: AICallResult;

  if (provider === "gemini") {
    // Gemini vision: inline image part
    const start = Date.now();
    const client = getGemini();
    const geminiModel = client.getGenerativeModel({
      model,
      ...(options.systemPrompt ? { systemInstruction: options.systemPrompt } : {}),
      generationConfig: {
        temperature: options.temperature ?? 0.3,
        maxOutputTokens: options.maxTokens ?? 8192,
      },
    });

    const response = await geminiModel.generateContent([
      { inlineData: { mimeType: mediaType, data: imageBase64 } },
      { text: userMessage },
    ]);

    const text = response.response.text();
    const inputTokens = response.response.usageMetadata?.promptTokenCount ?? 0;
    const outputTokens = response.response.usageMetadata?.candidatesTokenCount ?? 0;

    result = {
      content: text,
      model,
      inputTokens,
      outputTokens,
      costUsd: calculateCost(model, inputTokens, outputTokens),
      durationMs: Date.now() - start,
    };
  } else {
    // Default to Anthropic vision
    const anthropicModel =
      provider === "anthropic" ? model : AI_MODELS.PRIMARY;
    const content: ContentBlockParam[] = [
      {
        type: "image",
        source: { type: "base64", media_type: mediaType, data: imageBase64 },
      },
      { type: "text", text: userMessage },
    ];

    result = await callAnthropic(
      [{ role: "user", content }],
      { ...options, model: anthropicModel, maxTokens: options.maxTokens ?? 8192 }
    );
  }

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
    outputData: {
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      costUsd: result.costUsd,
    },
  });
}
