/**
 * Content processing pipeline types.
 * Each content type has its own ordered pipeline of stages.
 */

// ---------------------------------------------------------------------------
// Core enums
// ---------------------------------------------------------------------------

export type ContentType = "video" | "audio" | "note" | "document" | "question_set" | "image";
export type UploadStatus = "uploading" | "processing" | "completed" | "failed";
export type ReviewStatus = "pending" | "approved" | "rejected" | "flagged";

// ---------------------------------------------------------------------------
// Pipeline stages — every handler name maps to a stage
// ---------------------------------------------------------------------------

export type PipelineStage =
  | "generate_thumbnail"
  | "set_processed_url"
  | "extract_text"
  | "ai_summarize"
  | "ai_tag"
  | "ai_quality_check"
  | "ai_detect_language"
  | "complete";

// ---------------------------------------------------------------------------
// Runtime context shared across all stages within a single pipeline run
// ---------------------------------------------------------------------------

export interface PipelineContext {
  /** DB primary key */
  contentId: number;
  /** Full DB row (snapshot taken at pipeline start) */
  content: {
    id: number;
    creatorId: number;
    contentType: string;
    title: string;
    description: string | null;
    body: string | null;
    mediaUrl: string | null;
    thumbnailUrl: string | null;
    originalFileType: string | null;
    originalFileName: string | null;
    language: string | null;
    boardId: number | null;
    standardId: number | null;
    subjectId: number | null;
    chapterId: number | null;
    metadata: Record<string, unknown> | null;
    [key: string]: unknown;
  };
  /** Accumulates outputs across stages — written to DB after each stage */
  result: ProcessingResult;
  /** Mutable copy of content.metadata — persisted after each stage */
  metadata: Record<string, unknown>;
  /** Pipeline start timestamp (ms) */
  startTime: number;
}

// ---------------------------------------------------------------------------
// Stage handler signature
// ---------------------------------------------------------------------------

export type StageHandler = (ctx: PipelineContext) => Promise<void>;

// ---------------------------------------------------------------------------
// Results accumulated during pipeline execution
// ---------------------------------------------------------------------------

export interface ProcessingResult {
  aiSummary?: string;
  aiTags?: string[];
  aiQualityScore?: number;
  aiLanguage?: string;
  aiTranscript?: string;
  thumbnailUrl?: string;
  processedUrl?: string;
  extractedText?: string;
  suggestedTags?: {
    boardId?: number;
    standardId?: number;
    subjectId?: number;
    chapterId?: number;
    confidence: number;
  };
}

// ---------------------------------------------------------------------------
// Job data for BullMQ queue (unchanged interface)
// ---------------------------------------------------------------------------

export interface CreatorContentJobData {
  contentId: number;
  creatorId: number;
  action: "process_full" | "ai_summarize" | "ai_tag" | "ai_quality_check";
}

// ---------------------------------------------------------------------------
// Pipeline metadata shape (stored in content.metadata JSONB)
// ---------------------------------------------------------------------------

export interface PipelineMetadata {
  /** Name of the last attempted stage (completed or failed) */
  pipelineStage: string | null;
  /** Ordered list of successfully completed stage names */
  pipelineCompletedStages: string[];
  /** Error message from most recent failure */
  pipelineError?: string;
  /** ISO timestamp of when processing began */
  pipelineStartedAt?: string;
  /** Extracted text from documents (first 10000 chars) */
  extractedText?: string;
  /** Flag for future video HLS transcoding */
  transcodingTodo?: boolean;
  /** Existing media items from upload */
  mediaItems?: unknown[];
  /** Other existing metadata fields */
  [key: string]: unknown;
}
