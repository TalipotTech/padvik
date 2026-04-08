// ---------------------------------------------------------------------------
// Rich Content Extractor — AI-powered PDF content extraction with images
// ---------------------------------------------------------------------------
// Depends on: src/lib/ai/provider.ts (aiPdfVision, aiVision)
// Zero imports from: src/db/, src/app/

import { readFile } from "fs/promises";
import type {
  RichContentBlock,
  RichExtractionResult,
  ExtractionOptions,
  ExtractionMetadata,
  PageImage,
  CalloutVariant,
} from "./types";
import { renderPdfPages, countPdfPages } from "./pdf-renderer";

// 20MB — Gemini's inline data limit for PDFs
const MAX_GEMINI_PDF_SIZE = 20 * 1024 * 1024;

// ---------------------------------------------------------------------------
// System prompt for structured content extraction
// ---------------------------------------------------------------------------

const RICH_EXTRACTION_SYSTEM_PROMPT = `You are an expert educational content extractor for Indian K-12 textbooks (NCERT, SCERT, etc.).

Your task: Extract ALL content from this textbook page, preserving structure and formatting. Return a JSON array of content blocks in reading order.

## Block Types

1. **heading** — Chapter/section/subsection headings
   - Set "level": 1 for chapter titles, 2 for sections, 3 for subsections, 4 for sub-subsections

2. **text** — Body paragraphs, bullet points, numbered lists
   - Use markdown formatting (bold, italic, lists)
   - Preserve all text EXACTLY as written — do not paraphrase or summarize
   - DO NOT skip any text. Include every sentence on the page.

3. **image** — ONLY for labeled figures, diagrams, maps, illustrations, photographs, graphs
   - ONLY use this type when there is an actual figure/diagram with a label like "Fig. 1.1", "Figure 2.3", "Map 1", etc.
   - DO NOT create image blocks for decorative elements, page backgrounds, or QR codes
   - Set "content" to a detailed description of what the figure shows
   - Set "imageCaption" to the exact figure label and caption (e.g., "Figure 1.1 : India in the World")
   - Set "imageRef" to the figure reference ID (e.g., "fig_1.1", "map_1", "diagram_3.2")

4. **table** — Tables and comparison charts
   - Render as markdown table syntax with | header | format |

5. **formula** — Mathematical equations, chemical formulas
   - Use LaTeX notation (e.g., $x^2 + y^2 = r^2$)

6. **callout** — Special boxes: definitions, theorems, examples, notes, activities
   - NCERT-specific: "Activity", "Do You Know?", "Let's Discuss", "Box X.X", "Think and Discuss"
   - Set "calloutVariant" to: definition, theorem, example, note, important, or activity

## Output Format

Return ONLY a valid JSON array. Each element:
{
  "type": "heading" | "text" | "image" | "table" | "formula" | "callout",
  "content": "...",
  "level": 1-4,            // only for heading
  "imageCaption": "...",   // only for image — the exact figure label
  "imageRef": "fig_1.1",   // only for image — a short reference ID
  "calloutVariant": "...", // only for callout
  "pageNumber": 1
}

## Critical Rules
- Extract EVERY piece of text content — do not skip, summarize, or paraphrase
- Preserve original language (English, Hindi, etc.) exactly as written
- Extract ALL headings — section headings like "LOCATION", "SIZE", "INDIA AND THE WORLD" are critical. Do not miss any.
- For image blocks: describe the visual content in detail (what is shown, labels, colors, axes for graphs, data values)
- For bar charts/graphs: include the actual data values visible in the chart
- AVOID duplication: text that appears on the page should be in text blocks, NOT repeated in image descriptions
- SKIP these items (do NOT include as blocks):
  - Page numbers (e.g., "2", "3")
  - Running headers like "CONTEMPORARY INDIA-I", "CHAPTER 1", book title headers
  - Running footers like "Reprint 2025-26", "2025-26"
  - QR codes, barcodes, decorative elements
- Source citations below figures (e.g., "Source: United Nations...") should be included in the image block's content, NOT as a separate text block
- Callout boxes in NCERT: "Activity", "Do You Know?", "Let's Discuss", bullet-point questions → type=callout
- Chapter-end exercises: include under a heading block
- If a sentence is cut off at the page boundary, include the partial text — it will be merged with the next page`;

// ---------------------------------------------------------------------------
// Main extraction function
// ---------------------------------------------------------------------------

/**
 * Extract rich structured content from a PDF file.
 * Uses Gemini native PDF vision (primary) with page-level vision fallback.
 */
export async function extractRichContent(
  pdfPath: string,
  pageImages: PageImage[],
  options: ExtractionOptions = {}
): Promise<RichExtractionResult> {
  const pdfBuffer = await readFile(pdfPath);
  const pdfSize = pdfBuffer.length;
  const language = options.language ?? "en";
  const warnings: string[] = [];

  // Strategy selection — default to vision_pages (per-page Claude Vision)
  // Gemini PDF is only used when explicitly forced (it returns 403 on many projects)
  const strategy =
    options.forceStrategy ?? "vision_pages";

  console.log(
    `[RichExtractor] Strategy: ${strategy} | PDF size: ${(pdfSize / 1024 / 1024).toFixed(1)}MB | Pages: ${pageImages.length}`
  );

  let blocks: RichContentBlock[] = [];
  let metadata: ExtractionMetadata;

  if (strategy === "gemini_pdf") {
    try {
      const result = await extractViaGeminiPdf(pdfBuffer, language, options.maxPages);
      blocks = result.blocks;
      metadata = result.metadata;
      metadata.pdfPath = pdfPath;
      metadata.pageCount = pageImages.length;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      warnings.push(`Gemini PDF failed (${errMsg}), falling back to page vision`);
      console.warn(`[RichExtractor] Gemini PDF failed:`, errMsg);

      const result = await extractViaPageVision(pdfBuffer, pageImages, language, options.maxPages);
      blocks = result.blocks;
      metadata = result.metadata;
      metadata.pdfPath = pdfPath;
      metadata.pageCount = pageImages.length;
    }
  } else if (strategy === "vision_pages") {
    const result = await extractViaPageVision(pdfBuffer, pageImages, language, options.maxPages);
    blocks = result.blocks;
    metadata = result.metadata;
    metadata.pdfPath = pdfPath;
    metadata.pageCount = pageImages.length;
  } else {
    // text_only fallback
    const result = await extractTextOnly(pdfBuffer);
    blocks = result.blocks;
    metadata = result.metadata;
    metadata.pdfPath = pdfPath;
    metadata.pageCount = pageImages.length;
  }

  // Assign blockIndex and deduplicate
  blocks = deduplicateBlocks(blocks);
  blocks.forEach((b, i) => (b.blockIndex = i));

  // Patch image blocks with page image paths
  // Only assign page screenshots for actual labeled figures (not every page)
  for (const block of blocks) {
    if (block.type === "image") {
      const pageImg = pageImages.find((p) => p.pageNumber === block.pageNumber);
      if (pageImg) {
        block.imagePath = pageImg.relativePath;
      }
    }
  }

  // Generate markdown fallback
  const markdownFallback = blocksToMarkdown(blocks);

  return {
    blocks,
    pageImages,
    markdownFallback,
    metadata,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Strategy 1: Gemini Native PDF Vision
// ---------------------------------------------------------------------------

async function extractViaGeminiPdf(
  pdfBuffer: Buffer,
  language: string,
  maxPages?: number
): Promise<{ blocks: RichContentBlock[]; metadata: ExtractionMetadata }> {
  // Dynamic import to avoid circular deps
  const { aiPdfVision, AI_MODELS } = await import("@/lib/ai/provider");

  const pdfBase64 = pdfBuffer.toString("base64");
  const start = Date.now();

  const userPrompt = maxPages
    ? `Extract content from pages 1-${maxPages} of this PDF textbook. ${RICH_EXTRACTION_SYSTEM_PROMPT}`
    : `Extract ALL content from this PDF textbook. ${RICH_EXTRACTION_SYSTEM_PROMPT}`;

  const result = await aiPdfVision(userPrompt, pdfBase64, {
    model: AI_MODELS.GEMINI_FLASH,
    temperature: 0.1,
    maxTokens: 65536,
    jsonOutput: true,
    language,
  });

  const blocks = parseAIResponse(result.content);

  return {
    blocks,
    metadata: {
      strategy: "gemini_pdf",
      model: result.model,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      costUsd: result.costUsd,
      durationMs: Date.now() - start,
      pdfPath: "",
      pageCount: 0,
    },
  };
}

// ---------------------------------------------------------------------------
// Strategy 2: Per-page Vision (for large PDFs)
// ---------------------------------------------------------------------------

async function extractViaPageVision(
  pdfBuffer: Buffer,
  pageImages: PageImage[],
  language: string,
  maxPages?: number
): Promise<{ blocks: RichContentBlock[]; metadata: ExtractionMetadata }> {
  const { aiVision, AI_MODELS } = await import("@/lib/ai/provider");
  const { renderSinglePage } = await import("./pdf-renderer");

  const start = Date.now();
  const allBlocks: RichContentBlock[] = [];
  let totalInput = 0;
  let totalOutput = 0;
  let totalCost = 0;
  let model = "";

  const pagesToProcess = maxPages
    ? pageImages.slice(0, maxPages)
    : pageImages;

  // Process in batches of 3 pages
  const batchSize = 3;
  for (let i = 0; i < pagesToProcess.length; i += batchSize) {
    const batch = pagesToProcess.slice(i, i + batchSize);
    const pageNums = batch.map((p) => p.pageNumber);

    // For page vision, render each page and send as image
    for (const page of batch) {
      try {
        const pageBuffer = await renderSinglePage(pdfBuffer, page.pageNumber);
        const pageBase64 = pageBuffer.toString("base64");

        // System prompt establishes educational context to avoid content filtering
        const systemPrompt = "You are an educational content extraction tool for Indian K-12 textbooks (NCERT, SCERT). " +
          "You extract structured content from textbook page images. This is legitimate educational material. " +
          "Return valid JSON only.";

        const prompt = `Extract content from page ${page.pageNumber} of a textbook. ${RICH_EXTRACTION_SYSTEM_PROMPT}`;

        const result = await aiVision(
          prompt,
          pageBase64,
          "image/png",
          {
            systemPrompt,
            temperature: 0.1,
            maxTokens: 16384,
            jsonOutput: true,
            language,
          }
        );

        model = result.model;
        totalInput += result.inputTokens;
        totalOutput += result.outputTokens;
        totalCost += result.costUsd;

        const pageBlocks = parseAIResponse(result.content);
        for (const b of pageBlocks) {
          b.pageNumber = page.pageNumber;
        }
        allBlocks.push(...pageBlocks);
      } catch (err) {
        // Handle content filtering, rate limits, or provider errors gracefully
        const errMsg = err instanceof Error ? err.message : String(err);
        const isContentFilter = errMsg.includes("content filtering") || errMsg.includes("blocked");
        const status = (err as { status?: number }).status;

        if (isContentFilter || status === 400) {
          console.warn(`[RichExtractor] Page ${page.pageNumber} blocked by content filter, using text fallback`);
          // Fall back to text-only extraction for this page
          try {
            const { extractTextFromPdf } = await import("@/lib/scraper/parser");
            const text = await extractTextFromPdf(pdfBuffer);
            // Rough page estimation from text
            const lines = text.split("\n");
            const linesPerPage = Math.ceil(lines.length / (pageImages.length || 1));
            const startLine = (page.pageNumber - 1) * linesPerPage;
            const pageText = lines.slice(startLine, startLine + linesPerPage).join("\n").trim();
            if (pageText) {
              allBlocks.push({
                type: "text",
                content: pageText,
                pageNumber: page.pageNumber,
                blockIndex: 0,
              });
            }
          } catch {
            // Even text extraction failed — just skip this page
            console.warn(`[RichExtractor] Page ${page.pageNumber} text fallback also failed, skipping`);
          }
        } else if (status === 429 || status === 503) {
          // Rate limited — wait and retry once
          console.warn(`[RichExtractor] Rate limited on page ${page.pageNumber}, waiting 10s...`);
          await new Promise((r) => setTimeout(r, 10000));
          // Don't retry — just skip and let the next page proceed
        } else {
          // Unknown error — log and continue with remaining pages
          console.error(`[RichExtractor] Page ${page.pageNumber} failed: ${errMsg}`);
        }
      }
    }
  }

  return {
    blocks: allBlocks,
    metadata: {
      strategy: "vision_pages",
      model,
      inputTokens: totalInput,
      outputTokens: totalOutput,
      costUsd: totalCost,
      durationMs: Date.now() - start,
      pdfPath: "",
      pageCount: 0,
    },
  };
}

// ---------------------------------------------------------------------------
// Strategy 3: Text-only fallback
// ---------------------------------------------------------------------------

async function extractTextOnly(
  pdfBuffer: Buffer
): Promise<{ blocks: RichContentBlock[]; metadata: ExtractionMetadata }> {
  const { extractTextFromPdf } = await import("@/lib/scraper/parser");
  const start = Date.now();

  const text = await extractTextFromPdf(pdfBuffer);

  // Split into paragraphs and create simple text blocks
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
  const blocks: RichContentBlock[] = paragraphs.map((p, i) => ({
    type: "text" as const,
    content: p.trim(),
    pageNumber: 1,
    blockIndex: i,
  }));

  return {
    blocks,
    metadata: {
      strategy: "text_only",
      model: "pdf-parse",
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      durationMs: Date.now() - start,
      pdfPath: "",
      pageCount: 0,
    },
  };
}

// ---------------------------------------------------------------------------
// AI Response Parser
// ---------------------------------------------------------------------------

function parseAIResponse(content: string): RichContentBlock[] {
  try {
    // Try direct JSON parse
    const parsed = JSON.parse(content);
    const arr = Array.isArray(parsed) ? parsed : parsed.blocks ?? parsed.content ?? [];
    return normalizeBlocks(arr);
  } catch {
    // Try to extract JSON array from response
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        return normalizeBlocks(parsed);
      } catch {
        // Try repair: fix trailing comma, truncated JSON
        const repaired = repairJson(jsonMatch[0]);
        try {
          return normalizeBlocks(JSON.parse(repaired));
        } catch {
          console.error("[RichExtractor] Failed to parse AI response even after repair");
          return [
            {
              type: "text",
              content: content,
              pageNumber: 1,
              blockIndex: 0,
            },
          ];
        }
      }
    }

    // Last resort: return raw text as single block
    return [
      {
        type: "text",
        content: content,
        pageNumber: 1,
        blockIndex: 0,
      },
    ];
  }
}

function normalizeBlocks(raw: unknown[]): RichContentBlock[] {
  return raw
    .filter((item): item is Record<string, unknown> => item !== null && typeof item === "object")
    .map((item, i) => {
      const type = validateBlockType(String(item.type ?? "text"));
      const block: RichContentBlock = {
        type,
        content: String(item.content ?? ""),
        pageNumber: Number(item.pageNumber ?? item.page_number ?? item.page ?? 1),
        blockIndex: i,
      };

      if (type === "heading" && item.level) {
        const lvl = Number(item.level);
        block.level = (lvl >= 1 && lvl <= 4 ? lvl : 2) as 1 | 2 | 3 | 4;
      }

      if (type === "image") {
        block.imageCaption = item.imageCaption
          ? String(item.imageCaption)
          : item.image_caption
            ? String(item.image_caption)
            : item.caption
              ? String(item.caption)
              : undefined;
      }

      if (type === "callout" && item.calloutVariant) {
        block.calloutVariant = validateCalloutVariant(String(item.calloutVariant));
      } else if (type === "callout" && item.callout_variant) {
        block.calloutVariant = validateCalloutVariant(String(item.callout_variant));
      } else if (type === "callout" && item.variant) {
        block.calloutVariant = validateCalloutVariant(String(item.variant));
      }

      return block;
    });
}

function validateBlockType(t: string): RichContentBlock["type"] {
  const valid = ["heading", "text", "image", "table", "formula", "callout"];
  return valid.includes(t) ? (t as RichContentBlock["type"]) : "text";
}

function validateCalloutVariant(v: string): CalloutVariant {
  const valid = ["definition", "theorem", "example", "note", "important", "activity"];
  return valid.includes(v) ? (v as CalloutVariant) : "note";
}

// ---------------------------------------------------------------------------
// Deduplication — remove blocks whose text content is already covered
// ---------------------------------------------------------------------------

function deduplicateBlocks(blocks: RichContentBlock[]): RichContentBlock[] {
  const result: RichContentBlock[] = [];
  const seenText = new Set<string>();

  // Common NCERT page headers/footers to filter out
  const HEADER_FOOTER_PATTERNS = [
    /^reprint\s+\d{4}/i,
    /^\d{4}-\d{2,4}$/,
    /^contemporary india/i,
    /^democratic politics/i,
    /^india and the contemporary/i,
    /^economics$/i,
    /^\d+\s+(contemporary|democratic|india|economics)/i,
    /^(contemporary|democratic)\s+/i,
    /^\d+$/,  // just a page number
  ];

  for (const block of blocks) {
    const trimmed = block.content.trim();

    // Skip empty blocks
    if (trimmed.length < 3) continue;

    // Skip header/footer patterns for text blocks
    if (block.type === "text") {
      const isHeaderFooter = HEADER_FOOTER_PATTERNS.some((p) => p.test(trimmed));
      if (isHeaderFooter) continue;

      // Skip very short text that looks like page metadata
      if (trimmed.length < 20 && /^\d/.test(trimmed) && /india|chapter|reprint/i.test(trimmed)) continue;
    }

    // Normalize content for dedup comparison
    const key = trimmed
      .toLowerCase()
      .replace(/\s+/g, " ")
      .substring(0, 100);

    // Skip image blocks without a proper figure reference
    if (block.type === "image") {
      const caption = block.imageCaption ?? "";
      const hasCaption = (
        /fig(ure)?[\s._:-]*\d/i.test(caption) ||
        /map[\s._:-]*\d/i.test(caption) ||
        /diagram[\s._:-]*\d/i.test(caption) ||
        /table[\s._:-]*\d/i.test(caption) ||
        /graph[\s._:-]*\d/i.test(caption) ||
        /chart[\s._:-]*\d/i.test(caption) ||
        /illustration/i.test(caption) ||
        /photo/i.test(caption) ||
        /image/i.test(caption)
      );
      if (!hasCaption) continue;
    }

    // Check for near-duplicate text
    if (key.length > 5 && seenText.has(key)) continue;
    if (key.length > 5) seenText.add(key);

    result.push(block);
  }

  return result;
}

// ---------------------------------------------------------------------------
// JSON Repair (handles truncated AI output)
// ---------------------------------------------------------------------------

function repairJson(json: string): string {
  let repaired = json;

  // Remove trailing commas before ] or }
  repaired = repaired.replace(/,\s*([\]}])/g, "$1");

  // Try to close unclosed brackets
  let openBrackets = 0;
  let openBraces = 0;
  let inString = false;
  let escape = false;

  for (const ch of repaired) {
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "[") openBrackets++;
    if (ch === "]") openBrackets--;
    if (ch === "{") openBraces++;
    if (ch === "}") openBraces--;
  }

  // Close any unclosed strings
  if (inString) repaired += '"';

  // Close unclosed braces/brackets
  while (openBraces > 0) {
    repaired += "}";
    openBraces--;
  }
  while (openBrackets > 0) {
    repaired += "]";
    openBrackets--;
  }

  return repaired;
}

// ---------------------------------------------------------------------------
// Markdown Fallback Generator
// ---------------------------------------------------------------------------

export function blocksToMarkdown(blocks: RichContentBlock[]): string {
  const parts: string[] = [];

  for (const block of blocks) {
    switch (block.type) {
      case "heading": {
        const prefix = "#".repeat(block.level ?? 2);
        parts.push(`${prefix} ${block.content}\n`);
        break;
      }
      case "text":
        parts.push(`${block.content}\n`);
        break;
      case "image": {
        const caption = block.imageCaption ?? "Figure";
        parts.push(`[Figure: ${caption}]\n\n*${block.content}*\n`);
        break;
      }
      case "table":
        parts.push(`${block.content}\n`);
        break;
      case "formula":
        parts.push(`$$\n${block.content}\n$$\n`);
        break;
      case "callout": {
        const label =
          block.calloutVariant === "definition" ? "Definition"
          : block.calloutVariant === "theorem" ? "Theorem"
          : block.calloutVariant === "example" ? "Example"
          : block.calloutVariant === "important" ? "Important"
          : block.calloutVariant === "activity" ? "Activity"
          : "Note";
        parts.push(`${label}: ${block.content}\n`);
        break;
      }
    }
  }

  return parts.join("\n");
}
