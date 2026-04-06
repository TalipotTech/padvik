/**
 * AI Question Generator — generates board-exam-pattern questions from syllabus topics.
 *
 * Input: topic context (title, description, learning objectives, chapter, subject, board, grade)
 * Output: structured questions with text, options, answers, solutions, Bloom levels
 */
import { z } from "zod/v4";
import { AI_MODELS } from "../provider";

// ---------------------------------------------------------------------------
// Response schema
// ---------------------------------------------------------------------------
export const generatedOptionSchema = z.object({
  label: z.string(),
  text: z.string(),
  isCorrect: z.boolean(),
});

export const generatedQuestionSchema = z.object({
  questionText: z.string().min(1),
  questionType: z.string(),
  difficulty: z.string(),
  marks: z.union([z.number(), z.string()]).transform((v) =>
    typeof v === "string" ? parseFloat(v) || 1 : v
  ),
  bloomLevel: z.string().optional(),
  options: z.array(generatedOptionSchema).nullable().optional(),
  correctAnswer: z.union([z.string(), z.number()]).transform(String),
  solution: z.union([z.string(), z.number()]).transform(String).optional().default(""),
  tags: z.array(z.string()).nullable().optional(),
});

export const generateResponseSchema = z.object({
  questions: z.array(generatedQuestionSchema),
});

export type GeneratedQuestion = z.infer<typeof generatedQuestionSchema>;
export type GenerateResponse = z.infer<typeof generateResponseSchema>;

// ---------------------------------------------------------------------------
// Board exam patterns — used to guide the AI
// ---------------------------------------------------------------------------
const BOARD_PATTERNS: Record<string, string> = {
  CBSE: `CBSE Board Exam Pattern:
- Section A: MCQs — 1 mark each. 4 options, 1 correct. Test recall and basic understanding.
- Section B: Short Answer (SA-I) — 2 marks each. Require brief explanations (2-3 sentences).
- Section C: Short Answer (SA-II) — 3 marks each. Require detailed explanations with diagrams/examples.
- Section D: Long Answer (LA) — 5 marks each. Require comprehensive answers with diagrams, derivations, or case analysis.
- Section E: Case-Based/Source-Based — 4 marks each. Provide a passage/scenario and ask 4-5 sub-questions.
- Internal choice: Some questions offer "OR" alternatives.
- Marking scheme: Award marks for steps, not just final answer.`,

  ICSE: `ICSE Board Exam Pattern:
- Section A: Compulsory short answer questions covering entire syllabus.
- Section B: Choice-based questions with longer answers.
- Emphasis on application and analytical thinking.`,

  KL_SCERT: `Kerala SCERT Pattern:
- Focus on continuous evaluation and activity-based learning.
- Questions test understanding over rote memorization.
- Includes open-ended questions and project-based assessment.`,
};

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------
export const SYSTEM_PROMPT = `You are an expert question paper setter for Indian board examinations (CBSE, ICSE, Kerala SCERT, and all state boards).

You generate HIGH-QUALITY exam questions that:
1. Are ORIGINAL — never copy from existing papers. Create fresh, unique questions.
2. Follow the EXACT board exam pattern (marking scheme, question types, section structure).
3. Test the specified Bloom's Taxonomy level:
   - Remember: Recall facts, definitions, formulas
   - Understand: Explain concepts, compare, classify
   - Apply: Solve problems, use formulas in new contexts
   - Analyze: Break down information, identify patterns, compare/contrast
   - Evaluate: Justify decisions, assess validity, form judgments
   - Create: Design experiments, propose solutions, synthesize ideas
4. Include DETAILED solutions with step-by-step working, not just final answers.
5. For MCQs: Create plausible distractors based on common student misconceptions.
6. Use board-appropriate language and terminology.
7. Include mathematical notation where needed (use LaTeX: $x^2$, $\\frac{a}{b}$).
8. Support Hindi and regional Indian languages when requested.

QUESTION QUALITY RULES:
- Every MCQ must have exactly 4 options with ONE correct answer.
- Distractors should be plausible (common errors students make), not obviously wrong.
- Short answers should require genuine understanding, not just textbook copying.
- Long answers should test multi-step reasoning with opportunities for partial credit.
- Case-based questions should use real-world scenarios relevant to Indian students.
- Solutions must show complete working: formulas used, substitution, simplification, final answer.

OUTPUT: Return ONLY valid JSON with a "questions" array. No markdown, no explanation outside JSON.`;

// ---------------------------------------------------------------------------
// Build user prompt with full topic context
// ---------------------------------------------------------------------------
export interface GenerateParams {
  boardCode: string;
  grade: number;
  subjectName: string;
  chapterTitle: string;
  chapterNumber?: number;
  topicTitle: string;
  topicDescription?: string | null;
  learningObjectives?: string[] | null;
  topicBloomLevel?: string | null;
  questionType: string;
  difficulty: string;
  count: number;
  marks: number;
  language?: string;
  /** Optional: existing question texts to avoid duplication */
  existingQuestions?: string[];
}

export function buildUserPrompt(params: GenerateParams): string {
  const lines: string[] = [];

  // Context
  lines.push(`Board: ${params.boardCode}`);
  lines.push(`Grade/Class: ${params.grade}`);
  lines.push(`Subject: ${params.subjectName}`);
  lines.push(`Chapter: ${params.chapterNumber ? `${params.chapterNumber}. ` : ""}${params.chapterTitle}`);
  lines.push(`Topic: ${params.topicTitle}`);

  if (params.topicDescription) {
    lines.push(`Topic Description: ${params.topicDescription}`);
  }
  if (params.learningObjectives && params.learningObjectives.length > 0) {
    lines.push(`Learning Objectives:`);
    params.learningObjectives.forEach((obj, i) => {
      lines.push(`  ${i + 1}. ${obj}`);
    });
  }

  lines.push("");

  // Board pattern
  const pattern = BOARD_PATTERNS[params.boardCode];
  if (pattern) {
    lines.push(`Board Exam Pattern Reference:`);
    lines.push(pattern);
    lines.push("");
  }

  // Generation request
  lines.push(`GENERATE: ${params.count} ${params.questionType.replace("_", " ")} question${params.count > 1 ? "s" : ""}`);
  lines.push(`Difficulty: ${params.difficulty}`);
  lines.push(`Marks per question: ${params.marks}`);

  if (params.topicBloomLevel) {
    lines.push(`Target Bloom's Level: ${params.topicBloomLevel}`);
  }

  if (params.language && params.language !== "en") {
    const LANG_NAMES: Record<string, string> = {
      hi: "Hindi (हिन्दी)", ta: "Tamil (தமிழ்)", ml: "Malayalam (മലയാളം)",
      te: "Telugu (తెలుగు)", kn: "Kannada (ಕನ್ನಡ)", bn: "Bengali (বাংলা)",
    };
    lines.push(`Language: ${LANG_NAMES[params.language] ?? params.language}`);
  }

  // Avoid duplicates
  if (params.existingQuestions && params.existingQuestions.length > 0) {
    lines.push("");
    lines.push(`AVOID these existing questions (generate DIFFERENT ones):`);
    params.existingQuestions.slice(0, 10).forEach((q, i) => {
      lines.push(`  ${i + 1}. ${q.slice(0, 100)}`);
    });
  }

  lines.push("");
  lines.push("Return JSON: { \"questions\": [ { questionText, questionType, difficulty, marks, bloomLevel, options (for MCQ), correctAnswer, solution, tags } ] }");

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Parse and validate response
// ---------------------------------------------------------------------------
export function parseResponse(raw: string): GenerateResponse {
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  // Strip any non-JSON prefix
  const firstBrace = cleaned.indexOf("{");
  const firstBracket = cleaned.indexOf("[");
  const start = Math.min(
    firstBrace >= 0 ? firstBrace : Infinity,
    firstBracket >= 0 ? firstBracket : Infinity
  );
  if (start > 0 && start < Infinity) {
    cleaned = cleaned.slice(start);
  }

  let parsed: Record<string, unknown>;

  // Attempt 1: Direct parse
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Attempt 2: Fix trailing commas
    try {
      parsed = JSON.parse(cleaned.replace(/,\s*}/g, "}").replace(/,\s*]/g, "]"));
    } catch {
      // Attempt 3: Fix truncated JSON — find last complete question object
      try {
        const questionsMatch = cleaned.match(/"questions"\s*:\s*\[/);
        if (questionsMatch) {
          const arrayStart = cleaned.indexOf(questionsMatch[0]) + questionsMatch[0].length;
          let depth = 0;
          let lastComplete = arrayStart;
          let inStr = false;
          let esc = false;

          for (let i = arrayStart; i < cleaned.length; i++) {
            const ch = cleaned[i];
            if (esc) { esc = false; continue; }
            if (ch === "\\") { esc = true; continue; }
            if (ch === '"') { inStr = !inStr; continue; }
            if (inStr) continue;
            if (ch === "{") depth++;
            if (ch === "}") { depth--; if (depth === 0) lastComplete = i + 1; }
          }

          if (lastComplete > arrayStart) {
            const rebuilt = cleaned.slice(0, arrayStart) + cleaned.slice(arrayStart, lastComplete) + "]}";
            parsed = JSON.parse(rebuilt.replace(/,\s*}/g, "}").replace(/,\s*]/g, "]"));
          } else {
            throw new Error("No complete questions found");
          }
        } else {
          // Handle bare array response
          const arrMatch = cleaned.match(/^\[/);
          if (arrMatch) {
            let depth = 0;
            let lastComplete = 1;
            let inStr = false;
            let esc = false;
            for (let i = 1; i < cleaned.length; i++) {
              const ch = cleaned[i];
              if (esc) { esc = false; continue; }
              if (ch === "\\") { esc = true; continue; }
              if (ch === '"') { inStr = !inStr; continue; }
              if (inStr) continue;
              if (ch === "{") depth++;
              if (ch === "}") { depth--; if (depth === 0) lastComplete = i + 1; }
            }
            const rebuilt = cleaned.slice(0, lastComplete) + "]";
            const arr = JSON.parse(rebuilt.replace(/,\s*}/g, "}").replace(/,\s*]/g, "]"));
            parsed = { questions: arr };
          } else {
            throw new Error("Cannot repair JSON");
          }
        }
      } catch (repairErr) {
        throw new Error(
          `JSON parse failed: ${repairErr instanceof Error ? repairErr.message : String(repairErr)}. ` +
          `First 100 chars: ${cleaned.slice(0, 100)}`
        );
      }
    }
  }

  // Handle bare array response
  if (Array.isArray(parsed)) {
    parsed = { questions: parsed };
  }

  return generateResponseSchema.parse(parsed);
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
export const config = {
  model: AI_MODELS.PRIMARY, // Claude Sonnet for highest quality
  bulkModel: AI_MODELS.GEMINI_FLASH, // Gemini for cost-effective bulk generation
  temperature: 0.7, // Higher creativity for unique questions
  maxTokens: 16384, // Generous for long answer solutions
};
