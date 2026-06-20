/**
 * Question-set generator — produces a board-pattern practice question set for
 * a topic: 5 MCQs (1 mark), 2 short answers, and 1 long-answer/numerical (5 marks).
 *
 * Calls the existing centralized AI provider (src/lib/ai/provider.ts), parses
 * and validates the JSON output against the board exam composition rules, and
 * retries once with the validation errors fed back before giving up.
 */
import { z } from "zod";
import { aiChat } from "@/lib/ai/provider";
import { extractJson } from "@/lib/explainer/types";
import { resolveAutoContentModel, getAutoContentEffort } from "../ai-config";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------
const OptionSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  isCorrect: z.boolean(),
});

const MarkingRubricSchema = z.object({
  criteria: z
    .array(
      z.object({
        name: z.string().min(1),
        maxMarks: z.number(),
        description: z.string().min(1),
      })
    )
    .min(1),
  keywords: z.array(z.string()),
  acceptableVariations: z.array(z.string()),
  commonMistakes: z.array(z.string()),
});

const QuestionTypeSchema = z.enum([
  "mcq",
  "fill_blank",
  "true_false",
  "short_answer",
  "long_answer",
  "numerical",
]);

const DifficultySchema = z.enum(["easy", "medium", "hard"]);

const GeneratedQuestionSchema = z.object({
  questionText: z.string().min(1),
  questionType: QuestionTypeSchema,
  options: z.array(OptionSchema).optional(),
  correctAnswer: z.string().optional(),
  solution: z.string().min(1),
  marks: z.number().int().positive(),
  difficulty: DifficultySchema,
  markingRubric: MarkingRubricSchema.optional(),
});

export type GeneratedQuestion = z.infer<typeof GeneratedQuestionSchema>;

export interface GenerateQuestionSetParams {
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

export interface GenerateQuestionSetResult {
  questions: GeneratedQuestion[];
  model: string;
  costUsd: number;
  timeMs: number;
}

// Headroom for adaptive-thinking tokens (Opus) + the JSON output.
const MAX_TOKENS = 8000;
const TEMPERATURE = 0.6;

// Expected composition of a set
const EXPECTED_MCQ = 5;
const EXPECTED_SHORT = 2;
const EXPECTED_LONG_OR_NUMERICAL = 1;
const EXPECTED_TOTAL = EXPECTED_MCQ + EXPECTED_SHORT + EXPECTED_LONG_OR_NUMERICAL;
const MCQ_OPTION_COUNT = 4;

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------
function buildSystemPrompt(boardCode: string, standard: number, subject: string): string {
  return `You are an expert question paper setter for ${boardCode} board examinations.
Create practice questions for Class ${standard} ${subject} that EXACTLY match the pattern, difficulty, and marking scheme of actual board exam papers.

Generate this question set:
- 5 Multiple Choice Questions (1 mark each)
- 2 Short Answer Questions (2 marks each for science, 3 marks for maths)
- 1 Long Answer OR Numerical Problem (5 marks)

RULES:
- MCQ: 4 options (A-D), exactly one correct, plausible distractors
- EVERY question — including MCQs — MUST include a non-empty "solution" explaining why the answer is correct
- Short answers: include marking rubric with criteria and keywords
- Long answers: include step-by-step solution and marking rubric
- At least 1 application-based question (not rote memorization)
- Difficulty: 3 easy, 3 medium, 2 hard
- Include common mistakes students make (for AI grading reference)
- For maths/physics: include numerical problems with actual numbers
- Specify acceptable answer variations for subjective questions

Each question object MUST use EXACTLY these keys (do not rename or omit):
- questionText: string (required)
- questionType: 'mcq' | 'fill_blank' | 'true_false' | 'short_answer' | 'long_answer' | 'numerical' (required)
- options: [{ id: 'A', text: '...', isCorrect: true|false }]  (MCQ only — exactly 4, exactly one correct)
- correctAnswer: string (optional)
- solution: string (required, non-empty) — the worked step-by-step explanation. Use the key "solution", NOT "explanation" or "answer".
- marks: positive integer (required)
- difficulty: 'easy' | 'medium' | 'hard' (required)
- markingRubric: { criteria: [{ name, maxMarks, description }], keywords: [], acceptableVariations: [], commonMistakes: [] }  (short/long answers)

Return ONLY a JSON array of question objects. No markdown fences, no commentary.`;
}

function buildUserPrompt(params: GenerateQuestionSetParams): string {
  const { boardCode, standard, subject, chapter, topicName } = params;
  return `Create a practice question set for:
Topic: ${topicName}, Chapter: ${chapter}
Subject: ${subject}, Board: ${boardCode}, Class: ${standard}`;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
function coerceToArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) {
      if (Array.isArray(v)) return v;
    }
  }
  return [];
}

interface QuestionSetValidation {
  valid: boolean;
  errors: string[];
  questions: GeneratedQuestion[];
}

/**
 * Validate the question set against the board exam composition rules:
 * - exactly 5 MCQs, each with 4 options and exactly one isCorrect=true
 * - exactly 2 short answers (with solution + marks)
 * - exactly 1 long-answer/numerical (with solution + marks + rubric)
 * - every question has non-empty text and positive-integer marks (schema-enforced)
 */
function validateQuestionSet(items: unknown[]): QuestionSetValidation {
  const errors: string[] = [];
  const questions: GeneratedQuestion[] = [];

  items.forEach((item, i) => {
    const parsed = GeneratedQuestionSchema.safeParse(item);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const path = issue?.path?.length ? ` at "${issue.path.join(".")}"` : "";
      errors.push(`Question ${i} is invalid${path}: ${issue?.message ?? "unknown shape"}`);
      return;
    }
    questions.push(parsed.data);
  });

  // If any question failed schema parsing, stop here — composition checks would
  // be misleading against a partial set.
  if (errors.length > 0) {
    return { valid: false, errors, questions };
  }

  const mcqs = questions.filter((q) => q.questionType === "mcq");
  const shortAnswers = questions.filter((q) => q.questionType === "short_answer");
  const longOrNumerical = questions.filter(
    (q) => q.questionType === "long_answer" || q.questionType === "numerical"
  );

  if (questions.length !== EXPECTED_TOTAL) {
    errors.push(`Expected ${EXPECTED_TOTAL} questions, got ${questions.length}`);
  }

  // MCQs
  if (mcqs.length !== EXPECTED_MCQ) {
    errors.push(`Expected ${EXPECTED_MCQ} MCQs, got ${mcqs.length}`);
  }
  mcqs.forEach((q, i) => {
    const opts = q.options ?? [];
    if (opts.length !== MCQ_OPTION_COUNT) {
      errors.push(`MCQ ${i} must have exactly ${MCQ_OPTION_COUNT} options, got ${opts.length}`);
    }
    const correct = opts.filter((o) => o.isCorrect).length;
    if (correct !== 1) {
      errors.push(`MCQ ${i} must have exactly one correct option, got ${correct}`);
    }
  });

  // Short answers
  if (shortAnswers.length !== EXPECTED_SHORT) {
    errors.push(`Expected ${EXPECTED_SHORT} short-answer questions, got ${shortAnswers.length}`);
  }

  // Long answer / numerical (must carry a rubric)
  if (longOrNumerical.length !== EXPECTED_LONG_OR_NUMERICAL) {
    errors.push(
      `Expected ${EXPECTED_LONG_OR_NUMERICAL} long-answer/numerical question, got ${longOrNumerical.length}`
    );
  }
  longOrNumerical.forEach((q, i) => {
    if (!q.markingRubric) {
      errors.push(`Long-answer/numerical question ${i} must include a markingRubric`);
    }
  });

  return { valid: errors.length === 0, errors, questions };
}

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------
/**
 * Generate a board-pattern practice question set for a topic.
 * Throws if a valid set cannot be produced within one retry.
 */
export async function generateQuestionSet(
  params: GenerateQuestionSetParams
): Promise<GenerateQuestionSetResult> {
  const { boardCode, standard, subject, topicName, language } = params;

  const systemPrompt = buildSystemPrompt(boardCode, standard, subject);
  const userPrompt = buildUserPrompt(params);

  let totalCostUsd = 0;
  let totalTimeMs = 0;
  let model = "";
  let lastErrors: string[] = [];
  let validQuestions: GeneratedQuestion[] | null = null;

  // Attempt 0 = initial; attempt 1 = retry with errors fed back.
  for (let attempt = 0; attempt < 2 && !validQuestions; attempt++) {
    const message =
      attempt === 0
        ? userPrompt
        : `${userPrompt}\n\nThe previous output had these issues:\n${lastErrors
            .map((e) => `- ${e}`)
            .join("\n")}\n\nFix them and return the corrected JSON array.`;

    const res = await aiChat(
      message,
      {
        model: resolveAutoContentModel("question_set", params.modelOverride),
        effort: getAutoContentEffort(),
        systemPrompt,
        temperature: TEMPERATURE, // ignored by the Opus reasoning tier
        maxTokens: MAX_TOKENS,
        jsonOutput: true,
        // Language hint enables the provider's failover routing
        // (Indic languages route to Gemini first); English uses the default chain.
        ...(language ? { language } : {}),
      },
      {
        pipelineStage: "auto_content:question_set",
        entityType: "topic",
        entityId: Number(params.topicId),
      }
    );

    totalCostUsd += res.costUsd;
    totalTimeMs += res.durationMs;
    model = res.model;

    let parsed: unknown;
    try {
      parsed = extractJson(res.content);
    } catch (err) {
      lastErrors = [`Response was not valid JSON: ${(err as Error).message}`];
      console.warn(
        `[auto-content:question_set] JSON parse failed (attempt ${attempt + 1}) for "${topicName}"`,
        lastErrors
      );
      continue;
    }

    const validation = validateQuestionSet(coerceToArray(parsed));
    if (validation.valid) {
      validQuestions = validation.questions;
      break;
    }

    lastErrors = validation.errors;
    console.warn(
      `[auto-content:question_set] validation failed (attempt ${attempt + 1}) for "${topicName}"`,
      lastErrors
    );
  }

  if (!validQuestions) {
    throw new Error(
      `Failed to generate a valid question set for "${topicName}" (${boardCode} Class ${standard}) after retry. Errors: ${lastErrors.join("; ")}`
    );
  }

  return { questions: validQuestions, model, costUsd: totalCostUsd, timeMs: totalTimeMs };
}
