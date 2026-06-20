/**
 * Text-note generator — produces structured study notes for a topic as a
 * ContentBlock[] array (the same block shape the explainer renderer consumes).
 *
 * Calls the existing centralized AI provider (src/lib/ai/provider.ts), parses
 * and validates the JSON output, and retries once with the validation errors
 * fed back to the model before giving up.
 */
import { z } from "zod";
import { aiChat } from "@/lib/ai/provider";
import { ContentBlockSchema, extractJson, type ContentBlock } from "@/lib/explainer/types";
import { validateContentBlocks } from "./validate-blocks";
import { resolveAutoContentModel, getAutoContentEffort } from "../ai-config";

export interface GenerateTextNoteParams {
  topicId: bigint;
  boardCode: string;
  standard: number;
  subject: string;
  chapter: string;
  topicName: string;
  language?: string;
  /** Explicit model override (admin-selected); falls back to the default. */
  modelOverride?: string;
}

export interface GenerateTextNoteResult {
  title: string;
  blocks: ContentBlock[];
  model: string;
  costUsd: number;
  timeMs: number;
}

// Headroom for adaptive-thinking tokens (Opus) + the JSON output.
const MAX_TOKENS = 8000;
const TEMPERATURE = 0.7;

function buildSystemPrompt(boardCode: string, standard: number, subject: string): string {
  return `You are a senior curriculum expert creating study notes for Indian K-12 students on the Padvik Edutech platform.

QUALITY STANDARDS:
- Write for ${boardCode} Class ${standard} ${subject} specifically.
- Use NCERT terminology and examples where the board follows NCERT.
- Every abstract concept MUST have a visual element: an SVG diagram, a LaTeX formula, a comparison layout, or an analogy visualization.
- Use Indian context examples: cricket, monsoon, cooking, railways, markets, festivals, farming.
- Keep it concise: 800-1200 words. Students want clarity, not essays.
- Include 2-3 exam tips: 'This is frequently asked in board exams.'

STRUCTURE your notes as:
1. One-line introduction (what and why)
2. Key concepts (one ContentBlock per concept, with visual)
3. Important formulas (if any, as LaTeX)
4. Common mistakes students make
5. Quick revision points (5-7 bullet callout)

OUTPUT FORMAT — return a JSON array of ContentBlock objects:
- { type: 'heading', content: 'Section title' }
- { type: 'text', content: 'Markdown text paragraph' }
- { type: 'formula', latex: 'V = IR' }
- { type: 'diagram', svg: "<svg viewBox='0 0 400 250'>...</svg>" }
  SVG rules: use a viewBox, purple theme (#7C3AED primary, #1E1033 bg, #A78BFA accent, #C4B5FD labels), simple labeled diagrams, minimum font-size 12px, all text as <text> elements not <foreignObject>.
  CRITICAL: use SINGLE QUOTES for every SVG attribute (e.g. <svg viewBox='0 0 400 250'><rect x='10' fill='#7C3AED'/><text x='20' y='40'>Label</text></svg>) so the SVG fits inside the JSON string without breaking it. Never put a double quote (") inside the svg value.
- { type: 'callout', variant: 'tip'|'warning'|'remember'|'example', content: 'text' }
- { type: 'comparison', leftLabel: 'X', rightLabel: 'Y', left: 'description', right: 'description' }
- { type: 'steps', items: ['Step 1 text', 'Step 2 text'] }
- { type: 'analogy', source: 'familiar thing', target: 'new concept', mapping: [{ from: 'water pressure', to: 'voltage' }] }

OUTPUT RULES:
- Return ONLY the JSON array. No markdown fences, no explanation outside the array.
- The output MUST be valid JSON. Inside any string value, never use an unescaped double quote — use single quotes in all embedded markup (SVG/HTML) instead.`;
}

function buildUserPrompt(params: GenerateTextNoteParams): string {
  const { boardCode, standard, subject, chapter, topicName, language } = params;
  return `Create study notes for:
Topic: ${topicName}
Chapter: ${chapter}
Subject: ${subject}
Board: ${boardCode}, Class: ${standard}
Language: ${language || "English"}

Make sure to include at least ONE SVG diagram and ONE formula (if the topic involves any math or science concept).`;
}

/**
 * Parse the AI response into a value, tolerating a couple of common model
 * mistakes: fenced/▼prefixed JSON (handled by extractJson) and trailing commas
 * before } or ] (stripped on a second attempt).
 */
function parseJsonLoose(raw: string): unknown {
  try {
    return extractJson(raw);
  } catch (firstErr) {
    // Strip trailing commas (e.g. `... },]` or `... ,}`) and retry once.
    const repaired = raw.replace(/,(\s*[}\]])/g, "$1");
    if (repaired !== raw) {
      return extractJson(repaired);
    }
    throw firstErr;
  }
}

/**
 * Coerce a parsed AI response into a blocks array. Accepts a bare array, or an
 * object that wraps the array under a single property (e.g. { blocks: [...] }).
 */
function coerceToArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) {
      if (Array.isArray(v)) return v;
    }
  }
  return [];
}

/**
 * Generate structured study notes for a topic.
 * Throws if a valid ContentBlock[] cannot be produced within one retry.
 */
export async function generateTextNote(
  params: GenerateTextNoteParams
): Promise<GenerateTextNoteResult> {
  const { boardCode, standard, topicName, language } = params;

  const systemPrompt = buildSystemPrompt(boardCode, standard, params.subject);
  const userPrompt = buildUserPrompt(params);

  let totalCostUsd = 0;
  let totalTimeMs = 0;
  let model = "";
  let lastErrors: string[] = [];
  let validBlocks: unknown[] | null = null;

  // Attempt 0 = initial; attempt 1 = retry with errors fed back.
  for (let attempt = 0; attempt < 2 && !validBlocks; attempt++) {
    const message =
      attempt === 0
        ? userPrompt
        : `${userPrompt}\n\nThe previous output had these issues:\n${lastErrors
            .map((e) => `- ${e}`)
            .join("\n")}\n\nFix them and return the corrected JSON array.`;

    const res = await aiChat(
      message,
      {
        model: resolveAutoContentModel("text_note", params.modelOverride),
        effort: getAutoContentEffort(),
        systemPrompt,
        temperature: TEMPERATURE, // ignored by the Opus reasoning tier
        maxTokens: MAX_TOKENS,
        jsonOutput: true,
        // Passing a language hint enables the provider's failover routing
        // (Indic languages route to Gemini first); English uses the default chain.
        ...(language ? { language } : {}),
      },
      {
        pipelineStage: "auto_content:text_note",
        entityType: "topic",
        entityId: Number(params.topicId),
      }
    );

    totalCostUsd += res.costUsd;
    totalTimeMs += res.durationMs;
    model = res.model;

    let parsed: unknown;
    try {
      parsed = parseJsonLoose(res.content);
    } catch (err) {
      lastErrors = [`Response was not valid JSON: ${(err as Error).message}`];
      console.warn(
        `[auto-content:text_note] JSON parse failed (attempt ${attempt + 1}) for "${topicName}"`,
        lastErrors
      );
      continue;
    }

    const candidate = coerceToArray(parsed);
    const validation = validateContentBlocks(candidate);
    if (validation.valid) {
      validBlocks = candidate;
      break;
    }

    lastErrors = validation.errors;
    console.warn(
      `[auto-content:text_note] block validation failed (attempt ${attempt + 1}) for "${topicName}"`,
      lastErrors
    );
  }

  if (!validBlocks) {
    throw new Error(
      `Failed to generate valid study notes for "${topicName}" (${boardCode} Class ${standard}) after retry. Errors: ${lastErrors.join("; ")}`
    );
  }

  // Re-parse to obtain a fully typed ContentBlock[] (validation already passed).
  const blocks = z.array(ContentBlockSchema).parse(validBlocks);
  const title = `Study Notes: ${topicName} — ${boardCode} Class ${standard}`;

  return { title, blocks, model, costUsd: totalCostUsd, timeMs: totalTimeMs };
}
