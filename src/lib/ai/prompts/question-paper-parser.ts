/**
 * Question paper parser prompt — extracts structured questions
 * from raw PDF text of board exam papers, sample papers, and question banks.
 */
import { z } from "zod/v4";
import { AI_MODELS } from "../provider";

// ---------------------------------------------------------------------------
// Response schemas — validated with Zod after AI returns
// ---------------------------------------------------------------------------
export const optionSchema = z.object({
  label: z.union([z.string(), z.number()]).transform(String).optional().default(""),
  text: z.union([z.string(), z.number()]).transform(String).optional().default(""),
  isCorrect: z.boolean().optional(),
  is_correct: z.boolean().optional(),
  value: z.string().optional(),
}).transform((val) => ({
  label: val.label || "",
  text: val.text || val.value || val.label || "",
  isCorrect: val.isCorrect ?? val.is_correct,
}));

export const subPartSchema = z.object({
  partLabel: z.string().optional().default(""),
  questionText: z.string().optional().default(""),
  text: z.string().optional(), // alternative key the AI sometimes uses
  marks: z.number().min(0).optional().default(0),
  options: z.array(optionSchema).optional(),
  correctAnswer: z.string().nullable().optional(),
}).transform((val) => ({
  ...val,
  // Normalize: use whichever field has content
  questionText: val.questionText || val.text || "",
}));

export const parsedQuestionSchema = z.object({
  questionNumber: z.union([z.string(), z.number()]).transform(String),
  sectionLabel: z.string().nullable().optional(),
  questionType: z.string().default("short_answer"),
  questionText: z.string().min(1),
  subParts: z.array(subPartSchema).optional(),
  options: z.array(optionSchema).optional(),
  correctAnswer: z.union([z.string(), z.number()]).nullable().optional().transform((v) => v != null ? String(v) : v),
  solution: z.string().nullable().optional(),
  marks: z.union([z.number(), z.string()]).optional().default(1).transform((v) => typeof v === "string" ? parseFloat(v) || 1 : v),
  chapterHint: z.string().nullable().optional(),
  topicHint: z.string().nullable().optional(),
  difficulty: z.string().optional().default("medium"),
  bloomLevel: z.string().nullable().optional(),
  hasInternalChoice: z.boolean().optional(),
  internalChoiceText: z.string().nullable().optional(),
});

export const sectionSchema = z.object({
  label: z.union([z.string(), z.number()]).transform(String),
  title: z.string().nullable().optional(),
  marksPerQuestion: z.union([z.number(), z.string()]).nullable().optional().transform((v) => v != null ? (typeof v === "string" ? parseFloat(v) || null : v) : null),
  totalMarks: z.union([z.number(), z.string()]).nullable().optional().transform((v) => v != null ? (typeof v === "string" ? parseFloat(v) || null : v) : null),
  questionCount: z.union([z.number(), z.string()]).nullable().optional().transform((v) => v != null ? (typeof v === "string" ? parseInt(v) || null : v) : null),
});

export const questionPaperParseResultSchema = z.object({
  subjectName: z.string().min(1),
  subjectCode: z.union([z.string(), z.number()]).nullable().optional().transform((v) => v != null ? String(v) : v),
  grade: z.union([z.number(), z.string()]).transform((v) => typeof v === "string" ? parseInt(v) || 10 : v),
  paperYear: z.union([z.number(), z.string()]).nullable().optional().transform((v) => v != null ? (typeof v === "string" ? parseInt(v) || null : v) : null),
  totalMarks: z.union([z.number(), z.string()]).nullable().optional().transform((v) => v != null ? (typeof v === "string" ? parseFloat(v) || null : v) : null),
  durationMinutes: z.union([z.number(), z.string()]).nullable().optional().transform((v) => v != null ? (typeof v === "string" ? parseInt(v) || null : v) : null),
  paperType: z.string().nullable().optional(),
  sections: z.array(sectionSchema).optional(),
  questions: z.array(parsedQuestionSchema),
});

export type ParsedQuestion = z.infer<typeof parsedQuestionSchema>;
export type QuestionPaperParseResult = z.infer<typeof questionPaperParseResultSchema>;

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------
export const SYSTEM_PROMPT = `You are an expert parser of Indian board examination papers (CBSE, ICSE, Kerala SCERT, and all state boards).

Your task: Given raw text extracted from a question paper PDF, extract EVERY question as structured JSON.

BOARD EXAM PATTERNS (use these to correctly categorize questions):

CBSE Class X (2025-26):
- Section A: MCQs (Q1-20, 1 mark each = 20 marks)
- Section B: Short Answer (Q21-25, 2 marks each = 10 marks)
- Section C: Short Answer (Q26-31, 3 marks each = 18 marks)
- Section D: Long Answer (Q32-35, 5 marks each = 20 marks)
- Section E: Case-Based/Source-Based (Q36-38, 4 marks each = 12 marks)
- Total: 80 marks, 3 hours

CBSE Class XII (2025-26):
- Similar section pattern adjusted per subject
- Science subjects have practical + theory split

INDIAN LANGUAGE HANDLING:
Many CBSE papers are bilingual (English + Hindi) or may contain text in Hindi (हिन्दी), Tamil (தமிழ்), Malayalam (മലയാളം), Telugu (తెలుగు), Kannada (ಕನ್ನಡ), Bengali (বাংলা), Marathi (मराठी), Gujarati (ગુજરાતી), Punjabi (ਪੰਜਾਬੀ), Odia (ଓଡ଼ିଆ), Urdu (اردو), or other Indian languages.

LANGUAGE RULES:
1. For BILINGUAL papers (English + Hindi side by side): Extract the ENGLISH version of each question.
2. For HINDI-ONLY subjects (e.g., Hindi Course A, Hindi Course B): Keep the question text in Hindi (Devanagari script). Do NOT translate to English.
3. For REGIONAL LANGUAGE subjects (e.g., Tamil, Malayalam, Telugu papers): Keep the question text in the ORIGINAL language script. Do NOT translate.
4. For SANSKRIT papers: Keep text in Devanagari script.
5. The "language" field should be set based on what language the extracted question is in:
   - Hindi text → language hint "hi"
   - Tamil text → language hint "ta"
   - Malayalam text → language hint "ml"
   - Telugu text → language hint "te"
   - English text → language hint "en"
6. For mixed-language questions (e.g., a Hindi passage with English instructions), extract both parts as-is.
7. Mathematical expressions, formulas, and scientific notation should be preserved regardless of the language of the surrounding text.

EXTRACTION RULES:
1. Extract EVERY question from the paper — do not skip any.
2. For MCQs, extract ALL options (a/b/c/d) with their text.
3. For case-based questions, include the passage/case text as part of questionText, then extract each sub-part.
4. If a question has internal choice ("OR" alternatives), set hasInternalChoice: true and include the alternative in internalChoiceText.
5. Infer marks from the section structure if not explicitly stated per question.
6. Infer difficulty based on Bloom's taxonomy level and marks.
7. If possible, identify which chapter/topic a question relates to — put hints in chapterHint/topicHint.
8. For assertion-reason questions, classify as "assertion_reason" type.
9. If the paper has marking scheme or answers, extract correctAnswer and solution.
10. Do NOT hallucinate questions that aren't in the source text.
11. questionNumber should match the original paper numbering (e.g., "1", "2(a)", "36(i)").
12. For sub-parts, use the subParts array instead of creating separate questions.
13. Use only these questionType values: mcq, short_answer, long_answer, fill_blank, true_false, case_based, competency_based, assertion_reason, map_based, diagram_based.
14. difficulty must be one of: easy, medium, hard (lowercase).
15. bloomLevel must be one of: Remember, Understand, Apply, Analyze, Evaluate, Create (Title Case).

OUTPUT FORMAT: Return ONLY valid JSON matching this exact structure (no markdown fences, no extra text):

{
  "subjectName": "Mathematics",
  "subjectCode": "041",
  "grade": 10,
  "paperYear": 2025,
  "totalMarks": 80,
  "durationMinutes": 180,
  "paperType": "sqp",
  "sections": [
    { "label": "A", "title": "MCQs", "marksPerQuestion": 1, "totalMarks": 20, "questionCount": 20 }
  ],
  "questions": [
    {
      "questionNumber": "1",
      "sectionLabel": "A",
      "questionType": "mcq",
      "questionText": "If HCF(306, 657) = 9, then LCM(306, 657) is:",
      "options": [
        { "label": "a", "text": "22338", "isCorrect": true },
        { "label": "b", "text": "20342", "isCorrect": false },
        { "label": "c", "text": "22492", "isCorrect": false },
        { "label": "d", "text": "21114", "isCorrect": false }
      ],
      "correctAnswer": "a) 22338",
      "marks": 1,
      "chapterHint": "Real Numbers",
      "topicHint": "HCF and LCM",
      "difficulty": "easy",
      "bloomLevel": "Remember",
      "hasInternalChoice": false
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
  paperType?: string;
  subjectHint?: string;
  year?: number;
}): string {
  const lines: string[] = [];
  lines.push(`Board: ${params.boardCode}`);
  lines.push(`Class/Grade: ${params.grade}`);
  if (params.paperType) lines.push(`Paper Type: ${params.paperType}`);
  if (params.subjectHint) lines.push(`Subject: ${params.subjectHint}`);
  if (params.year) lines.push(`Year: ${params.year}`);

  // Detect if the text contains Indian language scripts
  const hasDevanagari = /[\u0900-\u097F]/.test(params.pdfText);
  const hasTamil = /[\u0B80-\u0BFF]/.test(params.pdfText);
  const hasMalayalam = /[\u0D00-\u0D7F]/.test(params.pdfText);
  const hasTelugu = /[\u0C00-\u0C7F]/.test(params.pdfText);
  const hasKannada = /[\u0C80-\u0CFF]/.test(params.pdfText);
  const hasBengali = /[\u0980-\u09FF]/.test(params.pdfText);
  const hasGujarati = /[\u0A80-\u0AFF]/.test(params.pdfText);
  const hasGurmukhi = /[\u0A00-\u0A7F]/.test(params.pdfText);

  const detectedScripts: string[] = [];
  if (hasDevanagari) detectedScripts.push("Hindi/Sanskrit (Devanagari)");
  if (hasTamil) detectedScripts.push("Tamil");
  if (hasMalayalam) detectedScripts.push("Malayalam");
  if (hasTelugu) detectedScripts.push("Telugu");
  if (hasKannada) detectedScripts.push("Kannada");
  if (hasBengali) detectedScripts.push("Bengali");
  if (hasGujarati) detectedScripts.push("Gujarati");
  if (hasGurmukhi) detectedScripts.push("Punjabi (Gurmukhi)");

  if (detectedScripts.length > 0) {
    lines.push(`Detected languages: ${detectedScripts.join(", ")}`);
    lines.push("IMPORTANT: Preserve the original language text. Do NOT translate regional language questions to English.");
  }

  lines.push("");
  lines.push(
    "Below is the raw text extracted from the question paper PDF. Parse EVERY question into the structured JSON format."
  );
  lines.push("");
  lines.push("---BEGIN QUESTION PAPER TEXT---");
  lines.push(params.pdfText.slice(0, 50000));
  lines.push("---END QUESTION PAPER TEXT---");

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Parse and validate the AI response
// ---------------------------------------------------------------------------
export function parseResponse(raw: string): QuestionPaperParseResult {
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  const parsed = repairAndParseJSON(cleaned);

  // Pre-clean: fix common AI output issues before Zod validation
  if (Array.isArray(parsed.questions)) {
    for (const q of parsed.questions) {
      // Ensure questionNumber is a string
      if (q.questionNumber !== undefined) {
        q.questionNumber = String(q.questionNumber);
      }

      // Normalize difficulty to lowercase enum
      if (q.difficulty) {
        const d = String(q.difficulty).toLowerCase().trim();
        q.difficulty = (["easy", "medium", "hard"].includes(d)) ? d : "medium";
      }

      // Normalize questionType to lowercase
      if (q.questionType) {
        q.questionType = String(q.questionType).toLowerCase().trim().replace(/\s+/g, "_");
      }

      // Normalize bloomLevel to Title Case
      if (q.bloomLevel) {
        const bl = String(q.bloomLevel).toLowerCase().trim();
        const BLOOM_MAP: Record<string, string> = {
          remember: "Remember", remembering: "Remember",
          understand: "Understand", understanding: "Understand",
          apply: "Apply", applying: "Apply", application: "Apply",
          analyze: "Analyze", analyse: "Analyze", analyzing: "Analyze", analysis: "Analyze",
          evaluate: "Evaluate", evaluating: "Evaluate", evaluation: "Evaluate",
          create: "Create", creating: "Create", creation: "Create",
        };
        q.bloomLevel = BLOOM_MAP[bl] ?? null;
      }

      // Normalize sectionLabel to single letter or short form
      if (q.sectionLabel !== undefined && q.sectionLabel !== null) {
        let sl = String(q.sectionLabel).trim().toUpperCase();
        sl = sl.replace(/^SECTION\s*/i, "");
        // Map long names to letters
        const SECTION_MAP: Record<string, string> = {
          "MCQ": "A", "MCQS": "A", "MULTIPLE CHOICE": "A",
          "SHORT ANSWER": "B", "SHORT": "B",
          "LONG ANSWER": "D", "LONG": "D",
          "CASE-BASED": "E", "CASE BASED": "E", "CASE-BASED QUESTIONS": "E", "CASE STUDY": "E", "CASE STUDIES": "E",
          "ASSERTION-REASON": "A", "ASSERTION REASON": "A",
          "COMPETENCY-BASED": "E", "COMPETENCY BASED": "E",
        };
        q.sectionLabel = SECTION_MAP[sl] ?? (sl.length <= 2 ? sl : sl.charAt(0));
      }

      // Ensure marks is a number
      if (typeof q.marks === "string") {
        q.marks = parseFloat(q.marks) || 0;
      }
      if (q.marks === undefined || q.marks === null) {
        q.marks = 1;
      }

      // Ensure questionText is present
      if (!q.questionText && q.text) {
        q.questionText = q.text;
      }
      if (!q.questionText) {
        q.questionText = "(Question text missing)";
      }

      // Normalize options: ensure label/text exist
      if (Array.isArray(q.options)) {
        q.options = q.options
          .filter((o: Record<string, unknown>) => o && (o.text || o.label))
          .map((o: Record<string, unknown>, i: number) => ({
            label: String(o.label ?? String.fromCharCode(97 + i)),
            text: String(o.text ?? o.value ?? o.label ?? ""),
            isCorrect: o.isCorrect ?? o.is_correct ?? undefined,
          }));
      }

      // Filter out empty/invalid sub-parts
      if (Array.isArray(q.subParts)) {
        q.subParts = q.subParts
          .filter(
            (sp: Record<string, unknown>) =>
              (sp.questionText && typeof sp.questionText === "string") ||
              (sp.text && typeof sp.text === "string")
          )
          .map((sp: Record<string, unknown>) => ({
            ...sp,
            partLabel: String(sp.partLabel ?? sp.part_label ?? sp.label ?? ""),
            questionText: String(sp.questionText ?? sp.text ?? ""),
            marks: typeof sp.marks === "string" ? parseFloat(sp.marks) || 0 : (sp.marks ?? 0),
          }));
        if (q.subParts.length === 0) {
          delete q.subParts;
        }
      }

      // Normalize hasInternalChoice
      if (q.hasInternalChoice !== undefined) {
        q.hasInternalChoice = Boolean(q.hasInternalChoice);
      }
    }

    // Filter out questions that still lack questionText after cleanup
    parsed.questions = parsed.questions.filter(
      (q: Record<string, unknown>) => q.questionText && String(q.questionText).trim().length > 0
    );
  }

  return questionPaperParseResultSchema.parse(parsed);
}

// ---------------------------------------------------------------------------
// Robust JSON parser — handles truncated, malformed AI output
// ---------------------------------------------------------------------------
function repairAndParseJSON(text: string): Record<string, unknown> {
  // Attempt 1: Direct parse
  try {
    return JSON.parse(text);
  } catch {
    // Continue to repair attempts
  }

  let repaired = text;

  // Strip any non-JSON prefix (AI sometimes adds text before JSON)
  const firstBrace = repaired.indexOf("{");
  if (firstBrace > 0) {
    repaired = repaired.slice(firstBrace);
  }

  // Attempt 2: Fix trailing commas (very common AI issue)
  try {
    const noTrailingCommas = repaired
      .replace(/,\s*}/g, "}")
      .replace(/,\s*]/g, "]");
    return JSON.parse(noTrailingCommas);
  } catch {
    // Continue
  }

  // Attempt 3: Fix truncated JSON — find the last complete question object
  // The AI often gets cut off mid-question, producing invalid JSON at the end
  try {
    // Find the questions array
    const questionsMatch = repaired.match(/"questions"\s*:\s*\[/);
    if (questionsMatch) {
      const arrayStart = repaired.indexOf(questionsMatch[0]) + questionsMatch[0].length;

      // Walk through the array to find complete objects
      let depth = 0;
      let lastCompleteEnd = arrayStart;
      let inString = false;
      let escapeNext = false;

      for (let i = arrayStart; i < repaired.length; i++) {
        const ch = repaired[i];

        if (escapeNext) {
          escapeNext = false;
          continue;
        }
        if (ch === "\\") {
          escapeNext = true;
          continue;
        }
        if (ch === '"') {
          inString = !inString;
          continue;
        }
        if (inString) continue;

        if (ch === "{") depth++;
        if (ch === "}") {
          depth--;
          if (depth === 0) {
            lastCompleteEnd = i + 1;
          }
        }
      }

      if (lastCompleteEnd > arrayStart) {
        // Rebuild JSON with only complete question objects
        const before = repaired.slice(0, arrayStart);
        const completeQuestions = repaired.slice(arrayStart, lastCompleteEnd);
        // Close the array and root object
        const rebuilt = before + completeQuestions + "]}";

        // Clean trailing commas
        const cleaned = rebuilt
          .replace(/,\s*}/g, "}")
          .replace(/,\s*]/g, "]");

        return JSON.parse(cleaned);
      }
    }
  } catch {
    // Continue
  }

  // Attempt 4: Extract just the questions array using regex
  // For severely broken JSON, try to salvage individual question objects
  try {
    const questionObjects: Record<string, unknown>[] = [];
    // Match individual {...} blocks that look like questions
    const objectPattern = /\{[^{}]*"questionText"\s*:\s*"[^"]*"[^{}]*\}/g;
    let match;
    while ((match = objectPattern.exec(repaired)) !== null) {
      try {
        const obj = JSON.parse(match[0]);
        if (obj.questionText) {
          questionObjects.push(obj);
        }
      } catch {
        // Skip this object
      }
    }

    if (questionObjects.length > 0) {
      // Try to extract top-level fields
      const subjectMatch = repaired.match(/"subjectName"\s*:\s*"([^"]*)"/);
      const gradeMatch = repaired.match(/"grade"\s*:\s*(\d+)/);

      return {
        subjectName: subjectMatch?.[1] ?? "Unknown",
        grade: gradeMatch ? parseInt(gradeMatch[1]) : 10,
        questions: questionObjects,
        _repaired: true,
        _repairedMethod: "regex_extraction",
        _originalQuestionCount: questionObjects.length,
      };
    }
  } catch {
    // Continue
  }

  // Attempt 5: Last resort — try to find ANY parseable JSON substring
  try {
    // Find the largest parseable JSON object from the start
    for (let end = repaired.length; end > 100; end -= 50) {
      const slice = repaired.slice(0, end);
      // Count open/close braces and try to balance
      const opens = (slice.match(/\{/g) ?? []).length;
      const closes = (slice.match(/\}/g) ?? []).length;
      const missing = opens - closes;

      if (missing >= 0) {
        const balanced = slice
          .replace(/,\s*$/, "")  // Remove trailing comma
          + "]".repeat(Math.max(0, (slice.match(/\[/g) ?? []).length - (slice.match(/]/g) ?? []).length))
          + "}".repeat(missing);

        try {
          const result = JSON.parse(balanced);
          if (result.questions || result.subjectName) {
            return { ...result, _repaired: true, _repairedMethod: "balanced_truncation" };
          }
        } catch {
          continue;
        }
      }
    }
  } catch {
    // Fall through
  }

  // All repair attempts failed
  throw new Error(
    `JSON repair failed. Response length: ${text.length} chars. ` +
    `First 100 chars: ${text.slice(0, 100)}... ` +
    `Last 100 chars: ...${text.slice(-100)}`
  );
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
export const config = {
  model: AI_MODELS.PRIMARY,
  temperature: 0.1,
  maxTokens: 16384,
};
