/**
 * Content processing pipeline types.
 */

export type ContentType = "video" | "audio" | "note" | "document" | "question_set" | "image";
export type UploadStatus = "uploading" | "processing" | "completed" | "failed";
export type ReviewStatus = "pending" | "approved" | "rejected" | "flagged";

export type PipelineStage =
  | "ai_summarize"
  | "ai_tag"
  | "ai_quality_check"
  | "ai_detect_language"
  | "ai_auto_tag_curriculum"
  | "complete";

export interface CreatorContentJobData {
  contentId: number;
  creatorId: number;
  action: "process_full" | "ai_summarize" | "ai_tag" | "ai_quality_check";
}

export interface ProcessingResult {
  aiSummary?: string;
  aiTags?: string[];
  aiQualityScore?: number;
  aiLanguage?: string;
  aiTranscript?: string;
  suggestedTags?: {
    boardId?: number;
    standardId?: number;
    subjectId?: number;
    chapterId?: number;
    confidence: number;
  };
}
