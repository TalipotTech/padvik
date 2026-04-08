// ---------------------------------------------------------------------------
// Rich Content Extraction Types
// ---------------------------------------------------------------------------
// Pure type definitions — zero runtime imports from src/db/ or src/app/

export type RichBlockType =
  | "heading"
  | "text"
  | "image"
  | "table"
  | "formula"
  | "callout";

export type CalloutVariant =
  | "definition"
  | "theorem"
  | "example"
  | "note"
  | "important"
  | "activity";

export interface RichContentBlock {
  /** Block type determines rendering strategy */
  type: RichBlockType;
  /** Markdown content (text, table, heading) or LaTeX (formula) or description (image) */
  content: string;
  /** Heading level 1-4, only for type=heading */
  level?: 1 | 2 | 3 | 4;
  /** For type=image: relative path to page screenshot containing the figure */
  imagePath?: string;
  /** For type=image: AI-generated caption describing the figure */
  imageCaption?: string;
  /** For type=callout: visual variant */
  calloutVariant?: CalloutVariant;
  /** Source page number in the PDF (1-indexed) */
  pageNumber: number;
  /** Sequential index within the extraction result */
  blockIndex: number;
}

export interface PageImage {
  /** 1-indexed page number */
  pageNumber: number;
  /** Relative path from project root, e.g. data/uploads/rich-content/42/page-1.png */
  relativePath: string;
  /** Image width in pixels */
  width: number;
  /** Image height in pixels */
  height: number;
}

export interface ExtractionMetadata {
  /** Which strategy was used: gemini_pdf | vision_pages | text_only */
  strategy: "gemini_pdf" | "vision_pages" | "text_only";
  /** AI model used */
  model: string;
  /** Input tokens consumed */
  inputTokens: number;
  /** Output tokens consumed */
  outputTokens: number;
  /** Estimated cost in USD */
  costUsd: number;
  /** Total extraction time in ms */
  durationMs: number;
  /** Source PDF path */
  pdfPath: string;
  /** Number of pages in the PDF */
  pageCount: number;
}

export interface RichExtractionResult {
  /** Structured content blocks in reading order */
  blocks: RichContentBlock[];
  /** Page image manifest */
  pageImages: PageImage[];
  /** Markdown fallback (always generated) */
  markdownFallback: string;
  /** Extraction metadata for logging */
  metadata: ExtractionMetadata;
  /** Non-fatal warnings during extraction */
  warnings: string[];
}

export interface ExtractionOptions {
  /** Force a specific strategy instead of auto-selecting */
  forceStrategy?: "gemini_pdf" | "vision_pages" | "text_only";
  /** Language hint for AI (default: "en") */
  language?: string;
  /** Max pages to process (default: all) */
  maxPages?: number;
  /** Output directory for page images (default: data/uploads/rich-content/{id}/) */
  outputDir?: string;
  /** Content item ID — used for image path generation */
  contentItemId?: number;
}
