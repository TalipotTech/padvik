/**
 * Structured OCR block extraction for handwritten notes.
 *
 * When AI extracts content from handwritten images, it returns structured
 * JSON blocks instead of flat markdown. This module handles:
 * - Parsing AI response into typed blocks
 * - Converting blocks to markdown (for body field / search)
 * - Converting blocks to RichContentBlock format (for RichContentViewer)
 */

// ---------------------------------------------------------------------------
// OCR Block Types
// ---------------------------------------------------------------------------

export interface OcrTextBlock {
  type: "text";
  content: string;
}

export interface OcrHeadingBlock {
  type: "heading";
  content: string;
  level: 1 | 2 | 3 | 4;
}

export interface OcrTableBlock {
  type: "table";
  headers: string[];
  rows: string[][];
  caption?: string;
  pattern?: string;
}

export interface OcrFormulaBlock {
  type: "formula";
  latex: string;
  description?: string;
  label?: string; // e.g. "HCF of 336 and 54"
}

export interface OcrDiagramBlock {
  type: "diagram";
  description: string;
  elements?: string[];
  diagramType?: string; // circuit, ray, force, graph, flowchart, etc.
  svg?: string; // optional inline SVG
}

export interface OcrDivisionLadderBlock {
  type: "division_ladder";
  number: number;
  steps: Array<{ divisor: number; quotient: number }>;
  result: string; // e.g. "2^4 × 3 × 7"
  caption?: string; // e.g. "Prime factorisation of 336"
}

export interface OcrProblemBlock {
  type: "problem";
  statement: string;
}

export interface OcrVerificationBlock {
  type: "verification";
  label?: string;
  latex: string;
  check?: string;
}

export type OcrBlock =
  | OcrTextBlock
  | OcrHeadingBlock
  | OcrTableBlock
  | OcrFormulaBlock
  | OcrDiagramBlock
  | OcrDivisionLadderBlock
  | OcrProblemBlock
  | OcrVerificationBlock;

// ---------------------------------------------------------------------------
// RichContentBlock type (matches rich-content-viewer.tsx)
// ---------------------------------------------------------------------------

interface RichContentBlock {
  type: "heading" | "text" | "image" | "table" | "formula" | "callout";
  content: string;
  level?: 1 | 2 | 3 | 4;
  imagePath?: string;
  imageCaption?: string;
  calloutVariant?: "definition" | "theorem" | "example" | "note" | "important" | "activity";
  pageNumber: number;
  blockIndex: number;
}

// ---------------------------------------------------------------------------
// OCR Prompt
// ---------------------------------------------------------------------------

/**
 * Build the OCR prompt for handwritten notes.
 *
 * Strategy: Ask AI to return ACCURATE markdown (what it's best at).
 * Then we post-process the markdown into structured blocks ourselves.
 * This gives best reading accuracy AND proper block structure.
 */
export function buildOcrPrompt(languageHint?: string): string {
  const hint = languageHint ? ` The handwriting is likely in ${languageHint}.` : "";

  return `Extract the handwritten content from this image and present it as a well-structured educational response in markdown.${hint}

This is an Indian K-12 math/science note. Your response should have these sections:

### Text and Data from the Image
- Problem statement (exact wording from the note)
- Key calculations shown (as LaTeX inline math: $x^2$, $\\frac{a}{b}$, $\\sqrt{n}$, $\\times$, $\\div$)

### Formatted Tables and Explanation
For any prime factorisation / division ladder in the note, format as a markdown table:
**Prime Factorisation of [number]:**
| Divisor | Number |
| :--- | :--- |
| 2 | 336 |
| 2 | 168 |
| ... | ... |
| | 1 |

Then show: $336 = 2^4 \\times 3 \\times 7$

Include brief mathematical explanation (how HCF/LCM was found, which theorem was used, etc.).

### Verification
If the note verifies a result (e.g. LCM × HCF = product), show both sides of the equation with LaTeX.

RULES:
- Copy numbers and text EXACTLY as written in the handwriting — do not rewrite or "correct" the steps
- Preserve the ORDER of division steps as written (if divisor starts with 3, show 3 first)
- Use markdown headings (##, ###), markdown tables (| col |), and LaTeX math ($...$ inline, $$...$$ display)
- Use "|  | 1 |" for empty-cell final rows in division ladders
- Don't wrap output in code fences or JSON`;
}

// ---------------------------------------------------------------------------
// Markdown → OcrBlocks parser (post-processing)
// ---------------------------------------------------------------------------

/**
 * Parse markdown OCR output into structured OcrBlocks.
 * This runs AFTER the AI returns accurate markdown — we split it into
 * typed blocks for proper rendering via OcrBlockRenderer.
 */
export function markdownToOcrBlocks(markdown: string): OcrBlock[] {
  const blocks: OcrBlock[] = [];
  const lines = markdown.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip empty lines
    if (!trimmed) { i++; continue; }

    // Headings
    const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      blocks.push({
        type: "heading",
        content: headingMatch[2],
        level: Math.min(4, headingMatch[1].length) as 1 | 2 | 3 | 4,
      });
      i++;
      continue;
    }

    // Markdown table: starts with | and has a separator row (|---|)
    if (trimmed.startsWith("|") && i + 1 < lines.length) {
      const tableResult = parseMarkdownTable(lines, i);
      if (tableResult) {
        // Check if this is a division ladder (headers = ["Divisor", "Number"/"Dividend"/"Quotient"])
        const h1 = tableResult.headers[1]?.toLowerCase() ?? "";
        const isLadder = tableResult.headers.length === 2 &&
          tableResult.headers[0].toLowerCase().includes("divisor") &&
          (h1.includes("number") || h1.includes("dividend") || h1.includes("quotient"));

        if (isLadder) {
          const ladder = tableToDivisionLadder(tableResult, blocks);
          if (ladder) {
            blocks.push(ladder);
            i = tableResult.endLine;
            // Check for result formula on next non-empty line
            i = skipEmpty(lines, i);
            if (i < lines.length) {
              const resultLine = lines[i].trim();
              const formulaMatch = resultLine.match(/^\$(.+)\$$/);
              if (formulaMatch && /\d+\s*=/.test(formulaMatch[1])) {
                // This is the factorisation result — attach to the ladder
                (blocks[blocks.length - 1] as OcrDivisionLadderBlock).result =
                  formulaMatch[1].replace(/^\d+\s*=\s*/, "");
                i++;
              }
            }
            continue;
          }
        }

        blocks.push({
          type: "table",
          headers: tableResult.headers,
          rows: tableResult.rows,
        });
        i = tableResult.endLine;
        continue;
      }
    }

    // Display formula: $$ ... $$ (single or multi-line)
    if (trimmed.startsWith("$$")) {
      // Single-line: $$formula$$ on the same line
      if (trimmed.endsWith("$$") && trimmed.length > 4) {
        const latex = trimmed.slice(2, -2).trim();
        if (latex) blocks.push({ type: "formula", latex });
        i++;
        continue;
      }
      // Multi-line: collect until closing $$
      let latex = trimmed.slice(2);
      i++;
      while (i < lines.length && !lines[i].trim().endsWith("$$")) {
        latex += "\n" + lines[i].trim();
        i++;
      }
      if (i < lines.length) {
        const lastLine = lines[i].trim();
        latex += "\n" + lastLine.slice(0, lastLine.length - 2);
        i++;
      }
      latex = latex.trim();
      if (latex) {
        blocks.push({ type: "formula", latex });
      }
      continue;
    }

    // Single-line display formula: line is entirely $...$
    if (trimmed.startsWith("$") && trimmed.endsWith("$") && !trimmed.startsWith("$$") && trimmed.length > 2) {
      const inner = trimmed.slice(1, -1).trim();
      // Only treat as formula block if it looks like a standalone equation (has =)
      if (inner.includes("=") && !inner.includes(" ")) {
        blocks.push({ type: "formula", latex: inner });
        i++;
        continue;
      }
    }

    // Diagram (blockquote with [Diagram])
    if (trimmed.startsWith(">") && trimmed.toLowerCase().includes("[diagram]")) {
      const desc = trimmed.replace(/^>\s*\[Diagram\]\s*/i, "").trim();
      blocks.push({ type: "diagram", description: desc || "Diagram" });
      i++;
      continue;
    }

    // Bold caption before a table (e.g. **Prime factorisation of 336**)
    if (trimmed.startsWith("**") && trimmed.endsWith("**") && i + 1 < lines.length) {
      const nextNonEmpty = skipEmpty(lines, i + 1);
      if (nextNonEmpty < lines.length && lines[nextNonEmpty].trim().startsWith("|")) {
        // This is a caption for the next table — don't emit it yet, let the table parser handle it
        // Store caption and advance
        const caption = trimmed.slice(2, -2);
        i = nextNonEmpty;
        const tableResult = parseMarkdownTable(lines, i);
        if (tableResult) {
          const isLadder = tableResult.headers.length === 2 &&
            tableResult.headers[0].toLowerCase().includes("divisor");
          if (isLadder) {
            const ladder = tableToDivisionLadder(tableResult, blocks);
            if (ladder) {
              ladder.caption = caption;
              blocks.push(ladder);
              i = tableResult.endLine;
              // Look for result formula
              i = skipEmpty(lines, i);
              if (i < lines.length) {
                const resultLine = lines[i].trim();
                const fm = resultLine.match(/^\$(.+)\$$/);
                if (fm && /\d+\s*=/.test(fm[1])) {
                  (blocks[blocks.length - 1] as OcrDivisionLadderBlock).result =
                    fm[1].replace(/^\d+\s*=\s*/, "");
                  i++;
                }
              }
              continue;
            }
          }
          blocks.push({ type: "table", headers: tableResult.headers, rows: tableResult.rows, caption });
          i = tableResult.endLine;
          continue;
        }
      }
    }

    // Default: accumulate text lines into a text block
    const textLines: string[] = [line];
    i++;
    while (i < lines.length) {
      const next = lines[i].trim();
      // Stop text accumulation at: headings, tables, display formulas, empty lines (2+)
      if (next.startsWith("#") || next.startsWith("|") || next.startsWith("$$") || next.startsWith("**")) break;
      if (!next && i + 1 < lines.length && !lines[i + 1].trim()) break; // double empty = break
      textLines.push(lines[i]);
      i++;
    }
    const textContent = textLines.join("\n").trim();
    if (textContent) {
      blocks.push({ type: "text", content: textContent });
    }
  }

  return blocks.length > 0 ? blocks : [{ type: "text", content: markdown }];
}

// ---------------------------------------------------------------------------
// Markdown table parser helper
// ---------------------------------------------------------------------------

interface ParsedTable {
  headers: string[];
  rows: string[][];
  endLine: number;
}

function parseMarkdownTable(lines: string[], startLine: number): ParsedTable | null {
  const headerLine = lines[startLine].trim();
  if (!headerLine.startsWith("|")) return null;

  // Parse header cells
  const headers = headerLine.split("|").map(s => s.trim()).filter(Boolean);

  // Next line should be separator (|---|---|)
  const sepLine = lines[startLine + 1]?.trim() ?? "";
  if (!sepLine.startsWith("|") || !sepLine.includes("-")) return null;

  // Parse data rows
  const rows: string[][] = [];
  let line = startLine + 2;
  while (line < lines.length) {
    const rowLine = lines[line].trim();
    if (!rowLine.startsWith("|")) break;
    const cells = rowLine.split("|").map(s => s.trim()).filter(Boolean);
    rows.push(cells);
    line++;
  }

  if (rows.length === 0) return null;

  return { headers, rows, endLine: line };
}

function tableToDivisionLadder(
  table: ParsedTable,
  _existingBlocks: OcrBlock[]
): OcrDivisionLadderBlock | null {
  if (table.rows.length < 2) return null;

  const firstRow = table.rows[0];
  const number = parseInt(firstRow[1] || firstRow[0], 10);
  if (isNaN(number)) return null;

  const steps: Array<{ divisor: number; quotient: number }> = [];

  for (let r = 0; r < table.rows.length; r++) {
    const row = table.rows[r];
    const divisor = parseInt(row[0], 10);
    const quotient = parseInt(row[1], 10);

    if (r === 0) {
      // First row: divisor | originalNumber — the quotient is the NEXT row's number
      const nextQuotient = parseInt(table.rows[r + 1]?.[1] ?? "0", 10);
      if (divisor && nextQuotient) {
        steps.push({ divisor, quotient: nextQuotient });
      }
    } else if (divisor && !isNaN(quotient)) {
      // Normal step row
      const nextQuotient = parseInt(table.rows[r + 1]?.[1] ?? "0", 10);
      if (r < table.rows.length - 1 && nextQuotient) {
        steps.push({ divisor, quotient: nextQuotient });
      } else {
        // Last row with a divisor — compute quotient as current_number / divisor
        // (handles case where AI skips the trailing "| | 1 |" row, e.g. "| 7 | 7 |" → quotient = 1)
        const computed = divisor > 0 ? Math.floor(quotient / divisor) : 0;
        steps.push({ divisor, quotient: computed > 0 ? computed : 1 });
      }
    }
  }

  if (steps.length === 0) return null;

  return {
    type: "division_ladder",
    number,
    steps,
    result: "",
    caption: undefined,
  };
}

function skipEmpty(lines: string[], from: number): number {
  while (from < lines.length && !lines[from].trim()) from++;
  return from;
}

// ---------------------------------------------------------------------------
// Parse AI Response
// ---------------------------------------------------------------------------

/**
 * Parse the AI vision response into structured blocks.
 *
 * Strategy:
 * 1. If response is JSON (rare — from jsonOutput:true), parse directly
 * 2. Otherwise treat as markdown and parse into blocks via markdownToOcrBlocks()
 */
export function parseOcrBlocks(aiResponse: string): OcrBlock[] {
  const trimmed = aiResponse.trim();

  // Try JSON first (in case jsonOutput was used)
  try {
    const jsonMatch = trimmed.match(/^\[[\s\S]*\]$/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return validateBlocks(parsed);
      }
    }
  } catch {
    // Not JSON — fall through to markdown parsing
  }

  // Primary path: parse markdown into structured blocks
  return markdownToOcrBlocks(trimmed);
}

/** Validate and clean parsed blocks */
function validateBlocks(raw: unknown[]): OcrBlock[] {
  const blocks: OcrBlock[] = [];

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const type = obj.type as string;

    switch (type) {
      case "text":
        if (typeof obj.content === "string" && obj.content.trim()) {
          blocks.push({ type: "text", content: obj.content });
        }
        break;

      case "heading":
        if (typeof obj.content === "string" && obj.content.trim()) {
          const level = Math.min(4, Math.max(1, Number(obj.level) || 2)) as 1 | 2 | 3 | 4;
          blocks.push({ type: "heading", content: obj.content, level });
        }
        break;

      case "table":
        if (Array.isArray(obj.headers) || Array.isArray(obj.rows)) {
          blocks.push({
            type: "table",
            headers: Array.isArray(obj.headers) ? obj.headers.map(String) : [],
            rows: Array.isArray(obj.rows)
              ? obj.rows.map((r) => (Array.isArray(r) ? r.map(String) : [String(r)]))
              : [],
            caption: typeof obj.caption === "string" ? obj.caption : undefined,
            pattern: typeof obj.pattern === "string" ? obj.pattern : undefined,
          });
        }
        break;

      case "formula":
        if (typeof obj.latex === "string" && obj.latex.trim()) {
          blocks.push({
            type: "formula",
            latex: obj.latex,
            description: typeof obj.description === "string" ? obj.description : undefined,
            label: typeof obj.label === "string" ? obj.label : undefined,
          });
        }
        break;

      case "diagram":
        if (typeof obj.description === "string" && obj.description.trim()) {
          blocks.push({
            type: "diagram",
            description: obj.description,
            elements: Array.isArray(obj.elements) ? obj.elements.map(String) : undefined,
            diagramType: typeof obj.diagramType === "string" ? obj.diagramType : undefined,
            svg: typeof obj.svg === "string" ? obj.svg : undefined,
          });
        }
        break;

      case "division_ladder":
        if (typeof obj.number === "number" && Array.isArray(obj.steps)) {
          blocks.push({
            type: "division_ladder",
            number: obj.number,
            steps: obj.steps
              .filter((s): s is Record<string, unknown> => s && typeof s === "object")
              .map((s) => ({
                divisor: Number(s.divisor) || 0,
                quotient: Number(s.quotient) || 0,
              })),
            result: typeof obj.result === "string" ? obj.result : "",
            caption: typeof obj.caption === "string" ? obj.caption : undefined,
          });
        }
        break;

      case "problem":
        if (typeof obj.statement === "string" && obj.statement.trim()) {
          blocks.push({
            type: "problem",
            statement: obj.statement,
          });
        }
        break;

      case "verification":
        if (typeof obj.latex === "string" && obj.latex.trim()) {
          blocks.push({
            type: "verification",
            latex: obj.latex,
            label: typeof obj.label === "string" ? obj.label : undefined,
            check: typeof obj.check === "string" ? obj.check : undefined,
          });
        }
        break;

      default:
        // Unknown type — treat as text if content exists
        if (typeof obj.content === "string" && obj.content.trim()) {
          blocks.push({ type: "text", content: obj.content });
        }
        break;
    }
  }

  // Post-process: deduplicate equations in text blocks
  // AI sometimes outputs "336 = 54 × 6 + 12\n$336 = 54 \\times 6 + 12$" — remove the plain text line
  for (const block of blocks) {
    if (block.type === "text") {
      block.content = deduplicateEquations(block.content);
    }
  }

  // Remove formula blocks that duplicate a division_ladder result
  // e.g. division_ladder has result "2^4 \times 3 \times 7" AND a separate formula "336 = 2^4 \times 3 \times 7"
  const ladderNumbers = new Set(
    blocks
      .filter((b): b is OcrDivisionLadderBlock => b.type === "division_ladder")
      .map((b) => b.number)
  );
  const ladderResults = new Set(
    blocks
      .filter((b): b is OcrDivisionLadderBlock => b.type === "division_ladder")
      .map((b) => b.result.replace(/\s+/g, ""))
  );
  const deduped = blocks.filter((b) => {
    if (b.type !== "formula") return true;
    // Check if formula starts with a ladder number (e.g. "336 = ...")
    const numberMatch = b.latex.match(/^(\d+)\s*=/);
    if (numberMatch && ladderNumbers.has(Number(numberMatch[1]))) return false;
    // Also check direct result match
    const formulaCore = b.latex.replace(/^\d+\s*=\s*/, "").replace(/\s+/g, "");
    return !ladderResults.has(formulaCore);
  });

  return deduped.length > 0 ? deduped : [{ type: "text", content: "[OCR: no content extracted]" }];
}

/**
 * Remove plain-text lines that duplicate a LaTeX equation on the next/prev line.
 * E.g. "336 = 54 × 6 + 12\n$336 = 54 \\times 6 + 12$" → "$336 = 54 \\times 6 + 12$"
 */
function deduplicateEquations(content: string): string {
  const lines = content.split("\n");
  const result: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const nextLine = lines[i + 1]?.trim() ?? "";
    const prevLine = lines[i - 1]?.trim() ?? "";

    // Skip plain text line if the next line is its LaTeX equivalent
    if (!line.startsWith("$") && nextLine.startsWith("$") && isEquationDuplicate(line, nextLine)) {
      continue;
    }

    // Skip plain text line if the previous line was its LaTeX equivalent
    if (!line.startsWith("$") && prevLine.startsWith("$") && isEquationDuplicate(line, prevLine)) {
      continue;
    }

    result.push(lines[i]); // preserve original spacing
  }

  return result.join("\n");
}

/** Check if a plain text line is a duplicate of a LaTeX line */
function isEquationDuplicate(plainLine: string, latexLine: string): boolean {
  // Strip $ delimiters and LaTeX commands to get the "core" equation
  const normalizedPlain = plainLine
    .replace(/\s+/g, "")
    .replace(/×/g, "*")
    .replace(/÷/g, "/")
    .replace(/[=+\-*/^{}()]/g, "");

  const normalizedLatex = latexLine
    .replace(/\$/g, "")
    .replace(/\\times/g, "*")
    .replace(/\\div/g, "/")
    .replace(/\\text\{[^}]*\}/g, "")
    .replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, "$1/$2")
    .replace(/\s+/g, "")
    .replace(/[=+\-*/^{}()\\]/g, "");

  // If the digits match, it's a duplicate
  const plainDigits = normalizedPlain.replace(/[^0-9]/g, "");
  const latexDigits = normalizedLatex.replace(/[^0-9]/g, "");

  return plainDigits.length >= 3 && plainDigits === latexDigits;
}

/** Attempt to repair truncated or malformed JSON */
function repairJson(raw: string): string {
  let json = raw;

  // Strip markdown code fences
  json = json.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");

  // Ensure it starts with [ and ends with ]
  const start = json.indexOf("[");
  if (start === -1) return `[${json}]`;
  json = json.substring(start);

  // Close unclosed brackets
  const openBrackets = (json.match(/\[/g) || []).length;
  const closeBrackets = (json.match(/\]/g) || []).length;
  for (let i = 0; i < openBrackets - closeBrackets; i++) {
    json += "]";
  }

  // Close unclosed braces
  const openBraces = (json.match(/\{/g) || []).length;
  const closeBraces = (json.match(/\}/g) || []).length;
  if (openBraces > closeBraces) {
    // Insert closing braces before the last ]
    const lastBracket = json.lastIndexOf("]");
    const closings = "}".repeat(openBraces - closeBraces);
    json = json.substring(0, lastBracket) + closings + json.substring(lastBracket);
  }

  return json;
}

// ---------------------------------------------------------------------------
// Block → Markdown Converter
// ---------------------------------------------------------------------------

/**
 * Convert structured blocks to clean markdown.
 * Used for the `body` field (search indexing, AI pipeline, backward compat).
 */
export function blocksToMarkdown(blocks: OcrBlock[]): string {
  return blocks
    .map((block) => {
      switch (block.type) {
        case "heading": {
          const prefix = "#".repeat(block.level);
          return `${prefix} ${block.content}`;
        }

        case "text":
          return block.content;

        case "table": {
          const allCols = block.headers.length > 0
            ? block.headers
            : block.rows[0]?.map((_, i) => `Col ${i + 1}`) ?? [];

          const headerRow = `| ${allCols.join(" | ")} |`;
          const separator = `| ${allCols.map(() => "---").join(" | ")} |`;
          const dataRows = block.rows.map((row) => `| ${row.join(" | ")} |`).join("\n");

          let md = `${headerRow}\n${separator}\n${dataRows}`;
          if (block.caption) md = `*${block.caption}*\n\n${md}`;
          if (block.pattern) md += `\n\n> Pattern: ${block.pattern}`;
          return md;
        }

        case "formula": {
          let md = `$$\n${block.latex}\n$$`;
          if (block.description) md += `\n\n*${block.description}*`;
          return md;
        }

        case "division_ladder": {
          // Render as a clean division table
          const caption = block.caption || `Prime factorisation of ${block.number}`;
          let md = `**${caption}**\n\n`;
          md += `| Divisor | Number |\n| --- | --- |\n`;
          // First row: divisor | original number
          if (block.steps.length > 0) {
            md += `| ${block.steps[0].divisor} | ${block.number} |\n`;
            for (let i = 0; i < block.steps.length; i++) {
              const step = block.steps[i];
              const nextStep = block.steps[i + 1];
              if (nextStep) {
                md += `| ${nextStep.divisor} | ${step.quotient} |\n`;
              } else {
                md += `| | ${step.quotient} |\n`;
              }
            }
          }
          if (block.result) {
            md += `\n$${block.number} = ${block.result}$`;
          }
          return md;
        }

        case "diagram": {
          let md = `> **[Diagram: ${block.diagramType ?? "illustration"}]** ${block.description}`;
          if (block.elements && block.elements.length > 0) {
            md += `\n> Elements: ${block.elements.join(", ")}`;
          }
          return md;
        }

        default:
          return "";
      }
    })
    .filter(Boolean)
    .join("\n\n");
}

// ---------------------------------------------------------------------------
// Block → Plain Text (for extractedText field — search indexing)
// ---------------------------------------------------------------------------

/**
 * Convert blocks to plain text for the extractedText field.
 * Strips formatting, keeps content readable for search.
 */
export function blocksToPlainText(blocks: OcrBlock[]): string {
  return blocks
    .map((block) => {
      switch (block.type) {
        case "heading":
        case "text":
          return block.content;
        case "table":
          return [
            block.caption,
            block.headers.join(", "),
            ...block.rows.map((r) => r.join(", ")),
            block.pattern,
          ].filter(Boolean).join("\n");
        case "formula":
          return [block.latex, block.description].filter(Boolean).join(" — ");
        case "division_ladder": {
          const steps = block.steps.map((s) => `${s.divisor} | ${s.quotient}`).join("\n");
          return [block.caption, `${block.number}:`, steps, block.result].filter(Boolean).join("\n");
        }
        case "diagram":
          return [block.description, block.elements?.join(", ")].filter(Boolean).join(". ");
        default:
          return "";
      }
    })
    .filter(Boolean)
    .join("\n\n");
}

// ---------------------------------------------------------------------------
// Block → RichContentBlock (for RichContentViewer rendering)
// ---------------------------------------------------------------------------

/**
 * Convert OCR blocks to the RichContentBlock format used by RichContentViewer.
 * This allows handwritten OCR content to render using the same rich viewer as PDFs.
 */
export function blocksToRichBlocks(blocks: OcrBlock[], pageNumber = 1): RichContentBlock[] {
  return blocks.map((block, index) => {
    switch (block.type) {
      case "heading":
        return {
          type: "heading" as const,
          content: block.content,
          level: block.level,
          pageNumber,
          blockIndex: index,
        };

      case "text":
        return {
          type: "text" as const,
          content: block.content,
          pageNumber,
          blockIndex: index,
        };

      case "table": {
        // Convert table to markdown for rendering via MarkdownRenderer inside RichContentViewer
        const allCols = block.headers.length > 0
          ? block.headers
          : block.rows[0]?.map((_, i) => `Col ${i + 1}`) ?? [];
        const headerRow = `| ${allCols.join(" | ")} |`;
        const separator = `| ${allCols.map(() => "---").join(" | ")} |`;
        const dataRows = block.rows.map((row) => `| ${row.join(" | ")} |`).join("\n");
        let content = `${headerRow}\n${separator}\n${dataRows}`;
        if (block.caption) content = `**${block.caption}**\n\n${content}`;
        if (block.pattern) content += `\n\n> *Pattern: ${block.pattern}*`;

        return {
          type: "table" as const,
          content,
          pageNumber,
          blockIndex: index,
        };
      }

      case "formula":
        return {
          type: "formula" as const,
          content: block.description
            ? `$$${block.latex}$$\n\n*${block.description}*`
            : `$$${block.latex}$$`,
          pageNumber,
          blockIndex: index,
        };

      case "division_ladder": {
        // Render as a styled division table with result formula
        const caption = block.caption || `Prime factorisation of ${block.number}`;
        let content = `**${caption}**\n\n`;
        content += `| Divisor | Number |\n| --- | --- |\n`;
        if (block.steps.length > 0) {
          content += `| ${block.steps[0].divisor} | ${block.number} |\n`;
          for (let i = 0; i < block.steps.length; i++) {
            const step = block.steps[i];
            const nextStep = block.steps[i + 1];
            if (nextStep) {
              content += `| ${nextStep.divisor} | ${step.quotient} |\n`;
            } else {
              content += `| | ${step.quotient} |\n`;
            }
          }
        }
        if (block.result) {
          content += `\n$$${block.number} = ${block.result}$$`;
        }

        return {
          type: "table" as const,
          content,
          pageNumber,
          blockIndex: index,
        };
      }

      case "diagram":
        return {
          type: "callout" as const,
          calloutVariant: "note" as const,
          content: block.svg
            ? block.svg
            : `**Diagram** (${block.diagramType ?? "illustration"}): ${block.description}${block.elements ? `\n\nElements: ${block.elements.join(", ")}` : ""}`,
          pageNumber,
          blockIndex: index,
        };

      default:
        return {
          type: "text" as const,
          content: "",
          pageNumber,
          blockIndex: index,
        };
    }
  });
}
