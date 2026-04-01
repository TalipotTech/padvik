/**
 * Syllabus parser prompt — extracts structured syllabus hierarchy
 * from raw PDF text content into our schema shape.
 */
import { z } from "zod/v4";
import { AI_MODELS } from "../provider";

// ---------------------------------------------------------------------------
// Response schema — validated with Zod after AI returns
// ---------------------------------------------------------------------------
export const topicSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  sortOrder: z.number().int().min(0),
});

export const chapterSchema = z.object({
  chapterNumber: z.number().int().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  estimatedHours: z.number().optional(),
  weightagePct: z.number().optional(),
  topics: z.array(topicSchema),
});

export const syllabusParseResultSchema = z.object({
  subjectName: z.string().min(1),
  subjectCode: z.string().min(1),
  grade: z.number().int().min(1).max(12),
  stream: z.string().nullable().optional(),
  academicYear: z.string().optional(),
  totalMarks: z.number().optional(),
  chapters: z.array(chapterSchema),
});

export type SyllabusParseResult = z.infer<typeof syllabusParseResultSchema>;

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------
export const SYSTEM_PROMPT = `You are an expert parser of Indian education board syllabi.

Your task: Given raw text extracted from a CBSE syllabus PDF, extract the structured hierarchy of chapters and topics.

RULES:
1. Extract ONLY information that is explicitly present in the text.
2. Each chapter must have a chapter number, title, and at least one topic.
3. Topics should be the specific learning items within a chapter.
4. If weightage percentages are mentioned, include them.
5. If estimated teaching hours are mentioned, include them.
6. Infer a subject code from the subject name (e.g., Mathematics → MATH, Physics → PHY, English → ENG).
7. Sort orders should be sequential starting from 0 for topics.
8. Do NOT hallucinate chapters or topics not in the source text.

OUTPUT FORMAT: Return ONLY valid JSON matching this exact structure (no markdown fences, no extra text):

{
  "subjectName": "Mathematics",
  "subjectCode": "MATH",
  "grade": 10,
  "stream": null,
  "academicYear": "2025-26",
  "totalMarks": 100,
  "chapters": [
    {
      "chapterNumber": 1,
      "title": "Real Numbers",
      "description": "...",
      "estimatedHours": 15,
      "weightagePct": 8,
      "topics": [
        { "title": "Euclid's Division Lemma", "description": "...", "sortOrder": 0 },
        { "title": "Fundamental Theorem of Arithmetic", "sortOrder": 1 }
      ]
    }
  ]
}`;

// ---------------------------------------------------------------------------
// Build the user prompt from extracted PDF text
// ---------------------------------------------------------------------------
export function buildUserPrompt(params: {
  pdfText: string;
  boardCode: string;
  grade: number;
  subjectHint?: string;
}): string {
  const subjectLine = params.subjectHint
    ? `The subject is likely: ${params.subjectHint}`
    : "Identify the subject from the content.";

  return `Board: ${params.boardCode}
Class/Grade: ${params.grade}
${subjectLine}

Below is the raw text extracted from the syllabus PDF. Parse it into the structured JSON format.

---BEGIN SYLLABUS TEXT---
${params.pdfText.slice(0, 50000)}
---END SYLLABUS TEXT---`;
}

// ---------------------------------------------------------------------------
// Parse and validate the AI response
// ---------------------------------------------------------------------------
export function parseResponse(raw: string): SyllabusParseResult {
  // Strip markdown code fences if present
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  const parsed = JSON.parse(cleaned);
  return syllabusParseResultSchema.parse(parsed);
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
export const config = {
  model: AI_MODELS.PRIMARY,
  temperature: 0.1,
  maxTokens: 8192,
};
