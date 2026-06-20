/**
 * Shared ContentBlock validator — reused by all auto-content generators
 * (text-note, question-set, …).
 *
 * Blocks are validated against the canonical ContentBlockSchema from the
 * explainer feature so generated notes render through the same block renderer
 * (src/components/explainer/blocks.tsx). On top of per-block schema validation
 * this enforces document-level rules: a minimum block count, presence of at
 * least one visual block, and a basic well-formedness check on inline SVG.
 */
import { ContentBlockSchema } from "@/lib/explainer/types";

/** Block types that count as "visual" for the at-least-one-visual rule. */
const VISUAL_BLOCK_TYPES = new Set(["diagram", "formula", "comparison", "analogy"]);

/** Minimum number of blocks a valid note must contain. */
const MIN_BLOCKS = 3;

export interface BlockValidationResult {
  valid: boolean;
  errors: string[];
}

/** Safely read a `.type` field off an unknown block for error messages. */
function blockType(block: unknown): string {
  if (block && typeof block === "object" && "type" in block) {
    const t = (block as { type: unknown }).type;
    return typeof t === "string" ? t : String(t);
  }
  return "unknown";
}

/**
 * Validate an array of (untrusted) content blocks.
 *
 * Checks:
 * - input is an array with at least MIN_BLOCKS entries
 * - each block matches ContentBlockSchema (valid type + required fields)
 * - diagram blocks contain something that looks like SVG (`<svg` … `</svg>`)
 * - at least one visual block (diagram, formula, comparison, or analogy)
 *
 * (Non-empty `latex`/`content` are already enforced by the schema's min(1).)
 */
export function validateContentBlocks(blocks: unknown[]): BlockValidationResult {
  const errors: string[] = [];

  if (!Array.isArray(blocks)) {
    return { valid: false, errors: ["Output is not a JSON array of content blocks"] };
  }

  if (blocks.length < MIN_BLOCKS) {
    errors.push(`Expected at least ${MIN_BLOCKS} blocks, got ${blocks.length}`);
  }

  let visualCount = 0;

  blocks.forEach((block, i) => {
    const parsed = ContentBlockSchema.safeParse(block);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const path = issue?.path?.length ? ` at "${issue.path.join(".")}"` : "";
      errors.push(
        `Block ${i} (type="${blockType(block)}") is invalid${path}: ${issue?.message ?? "unknown shape"}`
      );
      return;
    }

    const b = parsed.data;
    if (VISUAL_BLOCK_TYPES.has(b.type)) visualCount++;

    if (b.type === "diagram") {
      const svg = b.svg.trim();
      if (!svg.startsWith("<svg") || !svg.endsWith("</svg>")) {
        errors.push(
          `Block ${i} (diagram): svg must start with "<svg" and end with "</svg>"`
        );
      }
    }
  });

  if (visualCount < 1) {
    errors.push(
      "At least one visual block is required (diagram, formula, comparison, or analogy)"
    );
  }

  return { valid: errors.length === 0, errors };
}
