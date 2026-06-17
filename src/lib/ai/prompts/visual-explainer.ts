/**
 * Prompts for the Adaptive Visual Explainer.
 * Two flavours:
 *   1. Full-deck generation (3–7 cards for a topic at one level)
 *   2. Single-card re-explanation or Q&A answer
 *
 * Style rules come from docs/adaptive-visual-explainer-prompt.md.
 */
import { APPROACHES, type Approach } from "@/lib/explainer/types";

const PURPLE_THEME_HINT = `SVG style: viewBox='0 0 400 300'; palette #7C3AED (primary stroke/fill), #1E1033 (dark background), #A78BFA (accent), #C4B5FD (highlight). Keep shapes simple, always label key parts.`;

const CONTENT_BLOCK_HELP = `
ContentBlock types (use at least one VISUAL block per card — text-only cards are rejected):
- { "type": "text", "content": "short markdown paragraph" }
- { "type": "heading", "content": "Section heading" }
- { "type": "formula", "latex": "V = IR" }                     // KaTeX syntax
- { "type": "diagram", "svg": "<svg viewBox='0 0 400 300' ...>...</svg>" }
- { "type": "callout", "variant": "tip"|"warning"|"remember"|"example", "content": "..." }
- { "type": "comparison", "leftLabel": "X", "rightLabel": "Y", "left": "...", "right": "..." }
- { "type": "steps", "items": ["step 1", "step 2", ...] }
- { "type": "analogy", "source": "Water in pipes", "target": "Electric current",
    "mapping": [{"from":"Pressure","to":"Voltage"}, ...] }
- { "type": "quick_check", "question": "...", "options": ["A","B","C","D"],
    "correctIndex": 1, "explanation": "..." }
- { "type": "interactive_reveal", "prompt": "What do you think happens?", "answer": "..." }
`.trim();

const BASE_SYSTEM_PROMPT = `You are an expert visual educator for Indian K-12 students. You create explanation cards for topics in the Padvik learning platform. Each card explains ONE atomic concept with at least one visual element.

RULES:
- Every card MUST contain at least one visual block (diagram, formula, comparison, steps, analogy, quick_check, interactive_reveal, animation, or image). Cards with only text/heading blocks are INVALID.
- Use simple, clear language. No jargon without explanation.
- Every abstract concept needs a concrete, relatable Indian example (cricket, cooking, monsoon, railways, festivals, markets, auto-rickshaws, ration shops, etc.).
- ${PURPLE_THEME_HINT}
- LaTeX: KaTeX-compatible syntax only (avoid \\begin{align}; use \\cdot instead of \\times for multiplication in formulas when spacing matters; escape backslashes as \\\\ in JSON strings).
- Each card should take 30–90 seconds to read.
- Build from simplest concept to full understanding across the deck.

OUTPUT:
- Return ONLY valid JSON. No markdown code fences. No commentary.
- Shape: { "cards": [ ExplainerCard, ExplainerCard, ... ] }
- Each ExplainerCard has: title (string), subtitle (optional string), blocks (array of ContentBlock), approach (one of: ${APPROACHES.join(", ")}), estimatedReadTime (integer seconds, 30–120).

${CONTENT_BLOCK_HELP}`;

export const EXPLAINER_SYSTEM_PROMPT = BASE_SYSTEM_PROMPT;

// ---------------------------------------------------------------------------
// Full-deck generation
// ---------------------------------------------------------------------------
export interface DeckPromptContext {
  topicTitle: string;
  chapterTitle?: string;
  subjectName?: string;
  boardName?: string;
  grade?: number | null;
  level: 1 | 2 | 3;
  language?: string;
  learningObjectives?: string[];
}

const LEVEL_GUIDANCE: Record<1 | 2 | 3, string> = {
  1: "Difficulty: FOUNDATION. Explain as if the student is one class below. Use everyday analogies. Avoid technical terms until the final card. A previous-grade student should understand every example.",
  2: "Difficulty: STANDARD. Match the board textbook difficulty. Use NCERT-style explanations that cover exactly what the exam expects. Include one solved numerical example if the topic has numerics.",
  3: "Difficulty: ADVANCED. Go deeper than the textbook. Include real-world applications, edge cases, and connections to adjacent chapters. End with a challenging practice question in a quick_check block.",
};

export function buildDeckUserPrompt(ctx: DeckPromptContext): string {
  const lines: string[] = [];
  lines.push(`Create an explanation deck for the topic: "${ctx.topicTitle}"`);
  if (ctx.chapterTitle) lines.push(`Chapter: ${ctx.chapterTitle}`);
  if (ctx.subjectName) lines.push(`Subject: ${ctx.subjectName}`);
  if (ctx.boardName) lines.push(`Board: ${ctx.boardName}`);
  if (ctx.grade) lines.push(`Class / Grade: ${ctx.grade}`);
  if (ctx.language && ctx.language !== "en") {
    lines.push(`Primary language: ${ctx.language} (still keep LaTeX/symbols in ASCII).`);
  }
  if (ctx.learningObjectives && ctx.learningObjectives.length) {
    lines.push(`Learning objectives to cover: ${ctx.learningObjectives.join("; ")}`);
  }
  lines.push("");
  lines.push(LEVEL_GUIDANCE[ctx.level]);
  lines.push("");
  lines.push(
    "Produce 3–7 cards. Vary the approach (mix diagram, analogy, numerical, real_world, comparison, guided_problem). At least half the cards must include an SVG diagram or an analogy block. Return ONLY the JSON object described above."
  );
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Real-time single-card prompt
// ---------------------------------------------------------------------------
export interface ReExplainPromptContext {
  topicTitle: string;
  chapterTitle?: string;
  subjectName?: string;
  level: 1 | 2 | 3;
  previousApproaches: Approach[];
  studentQuestion?: string;
  language?: string;
}

const APPROACH_ROTATION_HELP = `
Approach rotation priority (use the first one NOT in the "already seen" list):
1. real_world — Indian daily-life analogy (water pipes, roads, cooking, monsoon, cricket, auto-rickshaws)
2. diagram — labelled SVG diagram that visualises the concept
3. numerical — step-by-step numerical example with actual numbers
4. comparison — compare with a concept the student has already learned
5. guided_problem — "Let's solve this together" with short blanks the student fills in
6. analogy — mapping-style analogy with a clear from→to table
`.trim();

export function buildReExplainUserPrompt(ctx: ReExplainPromptContext): string {
  const lines: string[] = [];
  lines.push(`Topic: "${ctx.topicTitle}"`);
  if (ctx.chapterTitle) lines.push(`Chapter: ${ctx.chapterTitle}`);
  if (ctx.subjectName) lines.push(`Subject: ${ctx.subjectName}`);
  lines.push(
    `Level: ${ctx.level === 1 ? "Foundation" : ctx.level === 3 ? "Advanced" : "Standard"}`
  );
  if (ctx.language && ctx.language !== "en") {
    lines.push(`Primary language: ${ctx.language}.`);
  }
  lines.push("");
  if (ctx.previousApproaches.length) {
    lines.push(
      `The student has ALREADY seen explanations using these approaches: ${ctx.previousApproaches.join(", ")}. You MUST use a different approach.`
    );
  } else {
    lines.push("The student wants a fresh take on the same concept.");
  }
  lines.push(APPROACH_ROTATION_HELP);
  lines.push("");
  if (ctx.studentQuestion) {
    lines.push(
      `The student asked this specific question: "${ctx.studentQuestion}". Answer THAT question directly with a visual — do not restate the general explanation.`
    );
  }
  lines.push("");
  lines.push(
    `Return ONLY a JSON object: { "cards": [ <one ExplainerCard> ] }. The card must have at least one visual block. Cost budget is tight — one focused card, not a deck.`
  );
  return lines.join("\n");
}
