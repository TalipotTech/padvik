/**
 * Parse questions from CSV and Excel files.
 * Auto-detects column mapping and converts rows to question objects.
 */
import Papa from "papaparse";
import ExcelJS from "exceljs";

export interface ColumnMapping {
  questionText: string;
  questionType?: string;
  difficulty?: string;
  optionA?: string;
  optionB?: string;
  optionC?: string;
  optionD?: string;
  correctAnswer?: string;
  solution?: string;
  marks?: string;
  bloomLevel?: string;
  tags?: string;
  chapter?: string;
  topic?: string;
}

export interface ParsedRow {
  questionText: string;
  questionType: string;
  difficulty: string;
  options?: { label: string; text: string; isCorrect?: boolean }[];
  correctAnswer?: string;
  solution?: string;
  marks: number;
  bloomLevel?: string;
  tags?: string[];
  chapterHint?: string;
  topicHint?: string;
}

/** Common header name patterns for auto-detection */
const COLUMN_PATTERNS: Record<keyof ColumnMapping, RegExp[]> = {
  questionText: [/question/i, /q\.?\s*text/i, /prompt/i],
  questionType: [/type/i, /q\.?\s*type/i, /format/i],
  difficulty: [/difficulty/i, /level/i, /diff/i],
  optionA: [/option\s*a/i, /opt\.?\s*a/i, /choice\s*a/i, /^a$/i],
  optionB: [/option\s*b/i, /opt\.?\s*b/i, /choice\s*b/i, /^b$/i],
  optionC: [/option\s*c/i, /opt\.?\s*c/i, /choice\s*c/i, /^c$/i],
  optionD: [/option\s*d/i, /opt\.?\s*d/i, /choice\s*d/i, /^d$/i],
  correctAnswer: [/correct/i, /answer/i, /key/i, /ans/i],
  solution: [/solution/i, /explanation/i, /reason/i],
  marks: [/marks?/i, /score/i, /points?/i, /weight/i],
  bloomLevel: [/bloom/i, /cognitive/i, /taxonomy/i],
  tags: [/tags?/i, /labels?/i, /categories?/i],
  chapter: [/chapter/i, /unit/i, /module/i],
  topic: [/topic/i, /sub.?topic/i, /concept/i],
};

/**
 * Auto-detect column mapping from header names.
 */
export function autoDetectColumns(headers: string[]): ColumnMapping {
  const mapping: Partial<ColumnMapping> = {};

  for (const header of headers) {
    const trimmed = header.trim();
    for (const [field, patterns] of Object.entries(COLUMN_PATTERNS)) {
      if (mapping[field as keyof ColumnMapping]) continue;
      if (patterns.some((p) => p.test(trimmed))) {
        (mapping as Record<string, string>)[field] = header;
      }
    }
  }

  if (!mapping.questionText) {
    // Fallback: use the first non-empty header
    mapping.questionText = headers[0] ?? "question";
  }

  return mapping as ColumnMapping;
}

/**
 * Apply column mapping to convert raw rows into parsed questions.
 */
export function applyMapping(
  rows: Record<string, string>[],
  mapping: ColumnMapping
): ParsedRow[] {
  return rows
    .filter((row) => row[mapping.questionText]?.trim())
    .map((row) => {
      const options: { label: string; text: string; isCorrect?: boolean }[] = [];
      const correctAns = row[mapping.correctAnswer ?? ""]?.trim()?.toLowerCase();

      if (mapping.optionA && row[mapping.optionA]?.trim()) {
        options.push({
          label: "a",
          text: row[mapping.optionA].trim(),
          isCorrect: correctAns === "a" || correctAns === row[mapping.optionA]?.trim()?.toLowerCase(),
        });
      }
      if (mapping.optionB && row[mapping.optionB]?.trim()) {
        options.push({
          label: "b",
          text: row[mapping.optionB].trim(),
          isCorrect: correctAns === "b" || correctAns === row[mapping.optionB]?.trim()?.toLowerCase(),
        });
      }
      if (mapping.optionC && row[mapping.optionC]?.trim()) {
        options.push({
          label: "c",
          text: row[mapping.optionC].trim(),
          isCorrect: correctAns === "c" || correctAns === row[mapping.optionC]?.trim()?.toLowerCase(),
        });
      }
      if (mapping.optionD && row[mapping.optionD]?.trim()) {
        options.push({
          label: "d",
          text: row[mapping.optionD].trim(),
          isCorrect: correctAns === "d" || correctAns === row[mapping.optionD]?.trim()?.toLowerCase(),
        });
      }

      const questionType =
        row[mapping.questionType ?? ""]?.trim()?.toLowerCase() ??
        (options.length > 0 ? "mcq" : "short_answer");

      return {
        questionText: row[mapping.questionText].trim(),
        questionType,
        difficulty: row[mapping.difficulty ?? ""]?.trim()?.toLowerCase() ?? "medium",
        options: options.length > 0 ? options : undefined,
        correctAnswer: row[mapping.correctAnswer ?? ""]?.trim(),
        solution: row[mapping.solution ?? ""]?.trim(),
        marks: parseFloat(row[mapping.marks ?? ""] ?? "1") || 1,
        bloomLevel: row[mapping.bloomLevel ?? ""]?.trim(),
        tags: row[mapping.tags ?? ""]
          ?.split(/[,;]/)
          .map((t) => t.trim())
          .filter(Boolean),
        chapterHint: row[mapping.chapter ?? ""]?.trim(),
        topicHint: row[mapping.topic ?? ""]?.trim(),
      };
    });
}

/**
 * Parse a CSV string into rows with auto-detected columns.
 */
export function parseCsv(csvContent: string): {
  headers: string[];
  rows: Record<string, string>[];
  mapping: ColumnMapping;
  parsed: ParsedRow[];
} {
  const result = Papa.parse<Record<string, string>>(csvContent, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });

  const headers = result.meta.fields ?? [];
  const mapping = autoDetectColumns(headers);
  const parsed = applyMapping(result.data, mapping);

  return { headers, rows: result.data, mapping, parsed };
}

/**
 * Parse an Excel file buffer into rows with auto-detected columns.
 */
export async function parseExcel(buffer: Buffer): Promise<{
  headers: string[];
  rows: Record<string, string>[];
  mapping: ColumnMapping;
  parsed: ParsedRow[];
}> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error("No worksheets found in the Excel file");

  const headers: string[] = [];
  const rows: Record<string, string>[] = [];

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) {
      // Header row
      row.eachCell((cell) => {
        headers.push(String(cell.value ?? "").trim());
      });
    } else {
      const record: Record<string, string> = {};
      row.eachCell((cell, colNumber) => {
        const header = headers[colNumber - 1];
        if (header) {
          record[header] = String(cell.value ?? "").trim();
        }
      });
      if (Object.values(record).some((v) => v)) {
        rows.push(record);
      }
    }
  });

  const mapping = autoDetectColumns(headers);
  const parsed = applyMapping(rows, mapping);

  return { headers, rows, mapping, parsed };
}
