/**
 * Audio-explainer generator — produces a 3-5 minute audio lesson for a topic.
 *
 * Two steps:
 *   1. The existing AI provider writes a warm, spoken script (500-750 words).
 *   2. A TTS provider converts the script to audio (ElevenLabs → Google → Sarvam,
 *      whichever key is configured; Sarvam preferred for Indic languages).
 *
 * If no TTS key is configured, the script is returned as a transcript with a
 * null audio buffer — callers can publish it as text with an "Audio coming soon"
 * badge.
 */
import { aiChat, isIndicLanguage } from "@/lib/ai/provider";
import { db } from "@/db";
import { contentPipelineLogs } from "@/db/schema/system";
import { resolveAutoContentModel } from "../ai-config";

export interface GenerateAudioExplainerParams {
  topicId: bigint;
  boardCode: string;
  standard: number;
  subject: string;
  chapter: string;
  topicName: string;
  language?: string;
  /** Explicit script-model override (admin-selected); TTS rotation is separate. */
  modelOverride?: string;
}

export interface GenerateAudioExplainerResult {
  /** MP3/WAV bytes, or null when no TTS provider is configured. */
  audioBuffer: Buffer | null;
  /** MIME type of audioBuffer ("audio/mpeg" or "audio/wav"); null when no audio. */
  audioMimeType: string | null;
  /** Why audio is missing (provider errors / no key); null when audio produced. */
  audioError: string | null;
  transcript: string;
  durationSecs: number;
  model: string;
  costUsd: number;
  timeMs: number;
}

const MAX_TOKENS = 1500;
const TEMPERATURE = 0.7;
const WORDS_PER_MINUTE = 150;

const MIN_WORDS = 400;
const MAX_WORDS = 900;

/** Sarvam TTS rejects inputs longer than 500 chars; stay under with margin. */
const SARVAM_MAX_INPUT_CHARS = 480;

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------
function buildSystemPrompt(boardCode: string, standard: number, topicName: string): string {
  return `You are a warm, friendly Indian teacher recording an audio lesson for students preparing for ${boardCode} Class ${standard} exams.

Write a 500-750 word spoken script (3-5 minutes when spoken).

STYLE:
- Conversational tone, like talking to a student face-to-face
- Start: 'Hello students! Today let's understand ${topicName}...'
- Use simple, short sentences
- Insert [PAUSE] markers for natural pauses
- Explain concepts with everyday Indian examples
- Say formulas verbally: 'V equals I multiplied by R'
- Include verbal cues: 'Now this is very important for your exams...'
- End with: 'Let me quickly revise what we covered today...'
- NO bullet points, NO markdown — this is pure spoken text
- Total word count: 500-750 words (aim for 600)`;
}

function buildUserPrompt(params: GenerateAudioExplainerParams): string {
  const { boardCode, standard, subject, chapter, topicName } = params;
  return `Write a spoken audio script for:
Topic: ${topicName}, Chapter: ${chapter}
Subject: ${subject}, Board: ${boardCode}, Class: ${standard}`;
}

// ---------------------------------------------------------------------------
// Script validation
// ---------------------------------------------------------------------------
/** Spoken text with [PAUSE] markers removed and whitespace collapsed. */
function cleanTranscript(script: string): string {
  return script.replace(/\[PAUSE\]/gi, " ").replace(/\s+/g, " ").trim();
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function hasMarkdownFormatting(script: string): boolean {
  return (
    /^#{1,6}\s/m.test(script) || // headings
    /\*\*/.test(script) || // bold
    /^\s*[-*+]\s/m.test(script) || // bullet lists
    /^\s*\d+\.\s/m.test(script) || // numbered lists
    /`/.test(script) // code/backticks
  );
}

function startsConversationally(transcript: string): boolean {
  return /^\s*(hello|hi|hey|namaste|namaskar|welcome|good (morning|afternoon|evening))\b/i.test(
    transcript
  );
}

interface ScriptValidation {
  valid: boolean;
  errors: string[];
  wordCount: number;
}

function validateScript(script: string): ScriptValidation {
  const errors: string[] = [];
  const transcript = cleanTranscript(script);
  const wordCount = countWords(transcript);

  if (wordCount < MIN_WORDS || wordCount > MAX_WORDS) {
    errors.push(`Script should be ${MIN_WORDS}-${MAX_WORDS} words, got ${wordCount}`);
  }
  if (!startsConversationally(transcript)) {
    errors.push("Script must open with a conversational greeting (e.g. 'Hello students!')");
  }
  if (hasMarkdownFormatting(script)) {
    errors.push("Script must be pure spoken text — no markdown (headings, bullets, bold, code)");
  }

  return { valid: errors.length === 0, errors, wordCount };
}

// ---------------------------------------------------------------------------
// TTS providers
// ---------------------------------------------------------------------------
type TtsProvider = "elevenlabs" | "google" | "sarvam";

/** Map a short language code to a BCP-47 Indian-locale tag. */
function toIndianLocale(language?: string): string {
  const lang = (language || "en").toLowerCase();
  const map: Record<string, string> = {
    en: "en-IN",
    hi: "hi-IN",
    ml: "ml-IN",
    ta: "ta-IN",
    te: "te-IN",
    kn: "kn-IN",
    mr: "mr-IN",
    gu: "gu-IN",
    bn: "bn-IN",
  };
  return map[lang] ?? "en-IN";
}

/** Preferred provider order — Sarvam first for Indic languages. */
function ttsProviderOrder(language?: string): TtsProvider[] {
  return isIndicLanguage(language)
    ? ["sarvam", "elevenlabs", "google"]
    : ["elevenlabs", "google", "sarvam"];
}

function ttsKeyPresent(provider: TtsProvider): boolean {
  switch (provider) {
    case "elevenlabs":
      return !!(process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_VOICE_ID);
    case "google":
      return !!process.env.GOOGLE_TTS_API_KEY;
    case "sarvam":
      return !!process.env.SARVAM_API_KEY;
  }
}

async function safeErrorBody(resp: Response): Promise<string> {
  try {
    return (await resp.text()).slice(0, 300);
  } catch {
    return "<no body>";
  }
}

// Option A — ElevenLabs (best quality)
async function ttsElevenLabs(text: string): Promise<Buffer> {
  const apiKey = process.env.ELEVENLABS_API_KEY!;
  const voiceId = process.env.ELEVENLABS_VOICE_ID!;
  const resp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: "eleven_multilingual_v2",
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
  });
  if (!resp.ok) {
    throw new Error(`ElevenLabs TTS failed: ${resp.status} ${await safeErrorBody(resp)}`);
  }
  return Buffer.from(await resp.arrayBuffer());
}

// Option B — Google Cloud TTS (cheaper)
async function ttsGoogle(text: string, language?: string): Promise<Buffer> {
  const apiKey = process.env.GOOGLE_TTS_API_KEY!;
  const languageCode = toIndianLocale(language);
  // Only en-IN has a guaranteed Neural2 voice name; for others, let Google pick
  // the default voice for the locale.
  const voice =
    languageCode === "en-IN" ? { languageCode, name: "en-IN-Neural2-A" } : { languageCode };

  const resp = await fetch(
    `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: { text },
        voice,
        audioConfig: { audioEncoding: "MP3" },
      }),
    }
  );
  if (!resp.ok) {
    throw new Error(`Google TTS failed: ${resp.status} ${await safeErrorBody(resp)}`);
  }
  const data = (await resp.json()) as { audioContent?: string };
  if (!data.audioContent) throw new Error("Google TTS returned no audioContent");
  return Buffer.from(data.audioContent, "base64");
}

/**
 * Split text into chunks that are guaranteed <= maxLen characters (word-based,
 * with a hard split for any single word longer than the limit). Sarvam's TTS
 * caps each input at 500 chars, so chunks must respect that ceiling exactly.
 */
function chunkText(text: string, maxLen: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  for (const word of words) {
    if (word.length > maxLen) {
      // Pathological single word — hard-split it.
      if (current) {
        chunks.push(current);
        current = "";
      }
      for (let i = 0; i < word.length; i += maxLen) {
        chunks.push(word.slice(i, i + maxLen));
      }
      continue;
    }
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxLen) {
      chunks.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

// ---------------------------------------------------------------------------
// WAV re-muxing — Sarvam returns one WAV per chunk; a raw Buffer.concat would
// leave multiple RIFF headers so most players only play the first segment.
// We parse each WAV, concatenate just the PCM payloads, and write a single
// valid header so multi-chunk Indic audio plays end-to-end.
// ---------------------------------------------------------------------------
interface WavParts {
  audioFormat: number;
  numChannels: number;
  sampleRate: number;
  bitsPerSample: number;
  data: Buffer;
}

function parseWav(buf: Buffer): WavParts | null {
  if (
    buf.length < 12 ||
    buf.toString("ascii", 0, 4) !== "RIFF" ||
    buf.toString("ascii", 8, 12) !== "WAVE"
  ) {
    return null;
  }
  let offset = 12;
  let fmt: Omit<WavParts, "data"> | null = null;
  let data: Buffer | null = null;

  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt ") {
      fmt = {
        audioFormat: buf.readUInt16LE(body),
        numChannels: buf.readUInt16LE(body + 2),
        sampleRate: buf.readUInt32LE(body + 4),
        bitsPerSample: buf.readUInt16LE(body + 14),
      };
    } else if (id === "data") {
      data = buf.subarray(body, body + size);
    }
    // Subchunks are word-aligned (padded to an even length).
    offset = body + size + (size % 2);
  }

  if (!fmt || !data) return null;
  return { ...fmt, data };
}

function buildWav(parts: WavParts): Buffer {
  const { audioFormat, numChannels, sampleRate, bitsPerSample, data } = parts;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(audioFormat, 20);
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/** Merge multiple WAV buffers into one valid WAV (falls back to naive concat). */
function concatWav(buffers: Buffer[]): Buffer {
  if (buffers.length === 1) return buffers[0];
  const parsed = buffers
    .map(parseWav)
    .filter((p): p is WavParts => p !== null);
  if (parsed.length === 0) return Buffer.concat(buffers); // unparseable — best effort
  const first = parsed[0];
  return buildWav({
    audioFormat: first.audioFormat,
    numChannels: first.numChannels,
    sampleRate: first.sampleRate,
    bitsPerSample: first.bitsPerSample,
    data: Buffer.concat(parsed.map((p) => p.data)),
  });
}

// Option C — Sarvam (Indian languages)
async function ttsSarvam(text: string, language?: string): Promise<Buffer> {
  const apiKey = process.env.SARVAM_API_KEY!;
  const targetLanguageCode = toIndianLocale(language);
  // Sarvam caps each input at 500 chars — chunk under that and concatenate.
  const chunks = chunkText(text, SARVAM_MAX_INPUT_CHARS);
  const buffers: Buffer[] = [];

  for (const chunk of chunks) {
    const resp = await fetch("https://api.sarvam.ai/text-to-speech", {
      method: "POST",
      headers: {
        "api-subscription-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        inputs: [chunk],
        target_language_code: targetLanguageCode,
        speaker: "anushka",
        model: "bulbul:v2",
        speech_sample_rate: 22050,
        enable_preprocessing: true,
      }),
    });
    if (!resp.ok) {
      throw new Error(`Sarvam TTS failed: ${resp.status} ${await safeErrorBody(resp)}`);
    }
    const data = (await resp.json()) as { audios?: string[] };
    const audio = data.audios?.[0];
    if (!audio) throw new Error("Sarvam TTS returned no audio");
    buffers.push(Buffer.from(audio, "base64"));
  }

  // Re-mux into a single valid WAV so all chunks play, not just the first.
  return concatWav(buffers);
}

/**
 * Synthesize audio using the first configured provider in preference order.
 * Returns null if no provider is configured or every configured one fails.
 */
type TtsOutcome =
  | { buffer: Buffer; mimeType: string; provider: TtsProvider; error: null }
  | { buffer: null; mimeType: null; provider: null; error: string };

/** TTS model label per provider (for the audit log). */
function ttsModelLabel(provider: TtsProvider, language?: string): string {
  switch (provider) {
    case "elevenlabs":
      return "eleven_multilingual_v2";
    case "google":
      return `google-tts:${toIndianLocale(language)}`;
    case "sarvam":
      return "bulbul:v2";
  }
}

/** Persist one TTS attempt to content_pipeline_logs (best-effort, never throws). */
async function logTtsAttempt(params: {
  entityId: number;
  provider: string;
  model: string;
  status: "completed" | "failed";
  durationMs: number;
  error?: string;
  output?: Record<string, unknown>;
}): Promise<void> {
  try {
    await db.insert(contentPipelineLogs).values({
      pipelineStage: "auto_content:tts",
      entityType: "topic",
      entityId: params.entityId,
      status: params.status,
      aiProvider: params.provider,
      aiModelUsed: params.model.slice(0, 50),
      processingTimeMs: params.durationMs,
      errorMessage: params.error ?? null,
      outputData: params.output ?? null,
    });
  } catch (e) {
    console.error("[auto-content:audio] failed to write TTS log:", (e as Error).message);
  }
}

async function synthesizeAudio(
  text: string,
  language: string | undefined,
  entityId: number
): Promise<TtsOutcome> {
  const order = ttsProviderOrder(language).filter(ttsKeyPresent);

  if (order.length === 0) {
    const error =
      "No TTS provider configured — set ELEVENLABS_API_KEY (+ELEVENLABS_VOICE_ID), GOOGLE_TTS_API_KEY, or SARVAM_API_KEY";
    console.warn(`[auto-content:audio] ${error} — returning transcript only`);
    await logTtsAttempt({
      entityId,
      provider: "none",
      model: "none",
      status: "failed",
      durationMs: 0,
      error,
    });
    return { buffer: null, mimeType: null, provider: null, error };
  }

  const failures: string[] = [];
  for (const provider of order) {
    const model = ttsModelLabel(provider, language);
    const start = Date.now();
    try {
      const buffer =
        provider === "elevenlabs"
          ? await ttsElevenLabs(text)
          : provider === "google"
            ? await ttsGoogle(text, language)
            : await ttsSarvam(text, language);
      // ElevenLabs & Google return MP3; Sarvam returns WAV.
      const mimeType = provider === "sarvam" ? "audio/wav" : "audio/mpeg";
      await logTtsAttempt({
        entityId,
        provider,
        model,
        status: "completed",
        durationMs: Date.now() - start,
        output: { bytes: buffer.length, mimeType },
      });
      return { buffer, provider, mimeType, error: null };
    } catch (err) {
      const message = (err as Error).message;
      console.warn(`[auto-content:audio] TTS provider "${provider}" failed:`, message);
      failures.push(`${provider}: ${message}`);
      await logTtsAttempt({
        entityId,
        provider,
        model,
        status: "failed",
        durationMs: Date.now() - start,
        error: message,
      });
    }
  }

  return {
    buffer: null,
    mimeType: null,
    provider: null,
    error: `All TTS providers failed — ${failures.join(" | ")}`,
  };
}

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------
/**
 * Generate an audio explainer: AI script + TTS audio.
 * Throws if a valid script cannot be produced within one retry. Audio failure
 * is non-fatal — the transcript is always returned (audioBuffer may be null).
 */
export async function generateAudioExplainer(
  params: GenerateAudioExplainerParams
): Promise<GenerateAudioExplainerResult> {
  const { boardCode, standard, topicName, language } = params;

  const systemPrompt = buildSystemPrompt(boardCode, standard, topicName);
  const userPrompt = buildUserPrompt(params);

  let totalCostUsd = 0;
  let totalTimeMs = 0;
  let model = "";
  let lastErrors: string[] = [];
  let script: string | null = null;
  let wordCount = 0;

  // Attempt 0 = initial; attempt 1 = retry with errors fed back.
  for (let attempt = 0; attempt < 2 && !script; attempt++) {
    const message =
      attempt === 0
        ? userPrompt
        : `${userPrompt}\n\nThe previous script had these issues:\n${lastErrors
            .map((e) => `- ${e}`)
            .join("\n")}\n\nFix them and return only the corrected spoken script.`;

    const res = await aiChat(
      message,
      {
        model: resolveAutoContentModel("audio_explainer", params.modelOverride),
        systemPrompt,
        temperature: TEMPERATURE,
        maxTokens: MAX_TOKENS,
        // Language hint enables the provider's failover routing.
        ...(language ? { language } : {}),
      },
      {
        pipelineStage: "auto_content:audio_explainer",
        entityType: "topic",
        entityId: Number(params.topicId),
      }
    );

    totalCostUsd += res.costUsd;
    totalTimeMs += res.durationMs;
    model = res.model;

    const candidate = res.content.trim();
    const validation = validateScript(candidate);
    if (validation.valid) {
      script = candidate;
      wordCount = validation.wordCount;
      break;
    }

    lastErrors = validation.errors;
    console.warn(
      `[auto-content:audio_explainer] script validation failed (attempt ${attempt + 1}) for "${topicName}"`,
      lastErrors
    );
  }

  if (!script) {
    throw new Error(
      `Failed to generate a valid audio script for "${topicName}" (${boardCode} Class ${standard}) after retry. Errors: ${lastErrors.join("; ")}`
    );
  }

  const transcript = cleanTranscript(script);
  const durationSecs = Math.round((wordCount / WORDS_PER_MINUTE) * 60);

  // TTS gets the spoken text with [PAUSE] markers turned into natural breaks.
  const ttsText = script.replace(/\[PAUSE\]/gi, ", ").replace(/\s+/g, " ").trim();
  const tts = await synthesizeAudio(ttsText, language, Number(params.topicId));

  return {
    audioBuffer: tts.buffer,
    audioMimeType: tts.mimeType,
    audioError: tts.error,
    transcript,
    durationSecs,
    model,
    costUsd: totalCostUsd,
    timeMs: totalTimeMs,
  };
}
