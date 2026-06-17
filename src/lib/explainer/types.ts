/**
 * Shared types + Zod validators for the Adaptive Visual Explainer feature.
 * Every AI-generated card passes through these validators before persistence
 * so the frontend can trust the card shape.
 */
import { z } from "zod";

export const APPROACHES = [
  "analogy",
  "diagram",
  "numerical",
  "real_world",
  "comparison",
  "guided_problem",
] as const;

export type Approach = (typeof APPROACHES)[number];

// ---------------------------------------------------------------------------
// Content blocks
// ---------------------------------------------------------------------------
const TextBlock = z.object({
  type: z.literal("text"),
  content: z.string().min(1),
});

const HeadingBlock = z.object({
  type: z.literal("heading"),
  content: z.string().min(1),
});

const FormulaBlock = z.object({
  type: z.literal("formula"),
  latex: z.string().min(1),
});

const DiagramBlock = z.object({
  type: z.literal("diagram"),
  svg: z.string().min(1),
});

const ImageBlock = z.object({
  type: z.literal("image"),
  url: z.string().url(),
  alt: z.string(),
});

const CalloutBlock = z.object({
  type: z.literal("callout"),
  variant: z.enum(["tip", "warning", "remember", "example"]),
  content: z.string().min(1),
});

const ComparisonBlock = z.object({
  type: z.literal("comparison"),
  leftLabel: z.string(),
  rightLabel: z.string(),
  left: z.string(),
  right: z.string(),
});

const StepsBlock = z.object({
  type: z.literal("steps"),
  items: z.array(z.string().min(1)).min(1),
});

const InteractiveRevealBlock = z.object({
  type: z.literal("interactive_reveal"),
  prompt: z.string().min(1),
  answer: z.string().min(1),
});

const QuickCheckBlock = z.object({
  type: z.literal("quick_check"),
  question: z.string().min(1),
  options: z.array(z.string()).min(2).max(6),
  correctIndex: z.number().int().min(0),
  explanation: z.string().min(1),
});

const AnalogyBlock = z.object({
  type: z.literal("analogy"),
  source: z.string().min(1),
  target: z.string().min(1),
  mapping: z
    .array(z.object({ from: z.string().min(1), to: z.string().min(1) }))
    .min(1),
});

const AnimationBlock = z.object({
  type: z.literal("animation"),
  frames: z
    .array(z.object({ svg: z.string().min(1), caption: z.string() }))
    .min(1),
  autoPlay: z.boolean().optional(),
});

export const ContentBlockSchema = z.discriminatedUnion("type", [
  TextBlock,
  HeadingBlock,
  FormulaBlock,
  DiagramBlock,
  ImageBlock,
  CalloutBlock,
  ComparisonBlock,
  StepsBlock,
  InteractiveRevealBlock,
  QuickCheckBlock,
  AnalogyBlock,
  AnimationBlock,
]);

export type ContentBlock = z.infer<typeof ContentBlockSchema>;

// ---------------------------------------------------------------------------
// Card schema — the AI returns a cards[] array that matches this shape.
// ---------------------------------------------------------------------------
export const ExplainerCardSchema = z.object({
  id: z.string().optional(),
  title: z.string().min(1),
  subtitle: z.string().optional(),
  blocks: z.array(ContentBlockSchema).min(1),
  approach: z.enum(APPROACHES),
  estimatedReadTime: z.number().int().positive().default(60),
  position: z.number().int().positive().optional(),
  variant: z.string().optional(),
  isPreGenerated: z.boolean().optional(),
});

export type ExplainerCard = z.infer<typeof ExplainerCardSchema>;

export const ExplainerDeckSchema = z.object({
  cards: z.array(ExplainerCardSchema).min(1).max(10),
});

export type ExplainerDeck = z.infer<typeof ExplainerDeckSchema>;

// ---------------------------------------------------------------------------
// Visual check — every card must have at least one visual block
// (text-only cards are a prompt failure and get rejected).
// ---------------------------------------------------------------------------
const VISUAL_BLOCK_TYPES = new Set<ContentBlock["type"]>([
  "formula",
  "diagram",
  "image",
  "comparison",
  "steps",
  "analogy",
  "animation",
  "quick_check",
  "interactive_reveal",
]);

export function cardHasVisual(card: ExplainerCard): boolean {
  return card.blocks.some((b) => VISUAL_BLOCK_TYPES.has(b.type));
}

/**
 * Attempts to pull a JSON object out of an AI response that may be wrapped
 * in ```json fences or prefixed with commentary.
 */
export function extractJson(raw: string): unknown {
  const trimmed = raw.trim();
  // Strip fenced code blocks
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenceMatch ? fenceMatch[1].trim() : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    // Try to locate the first { ... } or [ ... ]
    const firstBrace = candidate.indexOf("{");
    const firstBracket = candidate.indexOf("[");
    let start = -1;
    if (firstBrace === -1) start = firstBracket;
    else if (firstBracket === -1) start = firstBrace;
    else start = Math.min(firstBrace, firstBracket);
    if (start === -1) {
      throw new Error("No JSON object found in AI response");
    }
    const lastBrace = candidate.lastIndexOf("}");
    const lastBracket = candidate.lastIndexOf("]");
    const end = Math.max(lastBrace, lastBracket);
    return JSON.parse(candidate.slice(start, end + 1));
  }
}
