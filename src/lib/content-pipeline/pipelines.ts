/**
 * Pipeline definitions per content type.
 * Each content type has an ordered list of stages that run sequentially.
 */

import type { ContentType, PipelineStage } from "./types";

// ---------------------------------------------------------------------------
// Pipeline stage sequences
// ---------------------------------------------------------------------------

const VIDEO_PIPELINE: PipelineStage[] = [
  "generate_thumbnail",   // purple gradient placeholder (no ffmpeg)
  "set_processed_url",    // pass-through: processedUrl = mediaUrl
  "ai_summarize",         // from title + description
  "ai_tag",               // from title + description
  "ai_quality_check",     // rate 0-1
  "complete",             // set status, auto-publish
];

const AUDIO_PIPELINE: PipelineStage[] = [
  "set_processed_url",    // pass-through
  "ai_summarize",         // from title + description
  "ai_tag",
  "ai_quality_check",
  "complete",
];

const DOCUMENT_PIPELINE: PipelineStage[] = [
  "extract_text",         // PDF/DOCX text extraction
  "generate_thumbnail",   // render page 1 as PNG
  "ai_summarize",         // from extracted text
  "ai_tag",
  "ai_quality_check",
  "complete",
];

const IMAGE_PIPELINE: PipelineStage[] = [
  "generate_thumbnail",   // resize to 400px width
  "ai_tag",               // AI Vision for topic extraction
  "ai_quality_check",
  "complete",
];

const NOTE_PIPELINE: PipelineStage[] = [
  "ai_summarize",         // from body text
  "ai_tag",
  "ai_quality_check",
  "complete",
];

const QUESTION_SET_PIPELINE: PipelineStage[] = [
  "ai_quality_check",     // validate questions
  "complete",
];

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const PIPELINE_MAP: Record<ContentType, PipelineStage[]> = {
  video: VIDEO_PIPELINE,
  audio: AUDIO_PIPELINE,
  document: DOCUMENT_PIPELINE,
  image: IMAGE_PIPELINE,
  note: NOTE_PIPELINE,
  question_set: QUESTION_SET_PIPELINE,
};

/**
 * Get the ordered pipeline stages for a content type.
 * Falls back to NOTE pipeline for unknown types.
 */
export function getPipelineForContentType(ct: ContentType): PipelineStage[] {
  return PIPELINE_MAP[ct] ?? NOTE_PIPELINE;
}
