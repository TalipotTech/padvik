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
  description: z.string().nullable().optional(),
  sortOrder: z.number().int().min(0),
});

export const chapterSchema = z.object({
  chapterNumber: z.number().int().min(1),
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  estimatedHours: z.number().nullable().optional(),
  weightagePct: z.number().nullable().optional(),
  topics: z.array(topicSchema),
});

export const syllabusParseResultSchema = z.object({
  subjectName: z.string().min(1),
  subjectCode: z.string().min(1),
  grade: z.number().int().min(1).max(12),
  stream: z.string().nullable().optional(),
  academicYear: z.string().nullable().optional(),
  totalMarks: z.number().nullable().optional(),
  chapters: z.array(chapterSchema),
});

export type SyllabusParseResult = z.infer<typeof syllabusParseResultSchema>;

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------
export const SYSTEM_PROMPT = `You are an expert parser of Indian education board syllabi (CBSE, ICSE, Kerala SCERT, and all state boards).

Your task: Given raw text extracted from a syllabus PDF of any Indian education board, extract the structured hierarchy of chapters and topics.

RULES:
1. Extract ONLY information that is explicitly present in the text.
2. Each chapter must have a chapter number, title, and at least one topic.
3. Topics should be the specific learning items within a chapter.
4. If weightage percentages are mentioned, include them.
5. If estimated teaching hours are mentioned, include them.
6. Infer a subject code from the subject name (e.g., Mathematics → MATH, Physics → PHY, English → ENG).
7. Sort orders should be sequential starting from 0 for topics.
8. Do NOT hallucinate chapters or topics not in the source text.
9. If the syllabus contains content in a regional language (Malayalam, Tamil, Hindi, etc.), transliterate chapter/topic titles to English while preserving the original meaning.
10. Different boards may use different terminology (Unit vs Chapter, Module vs Topic) — normalize to "chapter" and "topic" in the output.

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
/**
 * Decode the most common HTML entities to plain text. Some source PDFs (especially
 * CISCE pages/subject labels) pass entity-encoded strings through the AI, which
 * otherwise land in our DB as literal "History &amp; Civics" or "Subject&#039;s".
 * Keep this intentionally small — anything exotic should land as-is for review.
 */
function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

/**
 * Some board PDFs (CISCE especially) list a numeric paper code like "869" that
 * AI models dutifully return as the subjectCode. Our unique index doesn't care,
 * but numeric codes look out of place alongside MATH/PHY/ENG. When we see a
 * purely-numeric or suspiciously-short code, synthesize one from the name.
 *
 * Preserves meaningful short codes (PHY, ENG, ART, MMC) — only rewrites when
 * the code is all digits (or a stub like "-" or "N/A").
 */
function deriveSubjectCode(name: string): string {
  // Strip parentheticals first so "Name (Region)" doesn't pollute initials
  // with individual letters from the parenthetical abbreviation.
  const stripped = name.replace(/\([^)]*\)/g, " ");
  const words = stripped
    .replace(/[^A-Za-z\s&]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0 && !/^(and|of|the|for|a|an|&)$/i.test(w));
  if (words.length === 0) return "SUBJ";
  if (words.length === 1) return words[0].slice(0, 12).toUpperCase();
  // For short names use full initials; for long names (>=4 words) cap at 8.
  const cap = words.length >= 4 ? 8 : 10;
  return words
    .map((w) => w[0])
    .join("")
    .slice(0, cap)
    .toUpperCase();
}

function isDegenerateCode(code: string): boolean {
  const trimmed = code.trim();
  if (trimmed.length === 0) return true;
  if (/^\d+$/.test(trimmed)) return true;           // purely numeric
  if (/^[-_\s]+$/.test(trimmed)) return true;       // just punctuation
  if (/^n\/?a$/i.test(trimmed)) return true;        // N/A, NA
  return false;
}

function normalizeTitles(result: SyllabusParseResult): SyllabusParseResult {
  result.subjectName = decodeHtmlEntities(result.subjectName).trim();
  result.subjectCode = decodeHtmlEntities(result.subjectCode).trim();
  // Replace AI-emitted numeric codes (paper numbers like "869") with synthesized
  // letter codes derived from the subject name.
  if (isDegenerateCode(result.subjectCode)) {
    result.subjectCode = deriveSubjectCode(result.subjectName);
  }
  for (const ch of result.chapters) {
    ch.title = decodeHtmlEntities(ch.title).trim();
    if (ch.description) ch.description = decodeHtmlEntities(ch.description).trim();
    for (const t of ch.topics) {
      t.title = decodeHtmlEntities(t.title).trim();
      if (t.description) t.description = decodeHtmlEntities(t.description).trim();
    }
  }
  return result;
}

export function parseResponse(raw: string): SyllabusParseResult {
  // Strip markdown code fences if present
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  const parsed = JSON.parse(cleaned);
  return normalizeTitles(syllabusParseResultSchema.parse(parsed));
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
export const config = {
  model: AI_MODELS.PRIMARY,
  temperature: 0.1,
  maxTokens: 8192,
};
