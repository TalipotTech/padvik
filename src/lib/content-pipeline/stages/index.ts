/**
 * Stage registry — maps pipeline stage names to their handler functions.
 */

import type { PipelineStage, StageHandler } from "../types";
import { handleGenerateThumbnail } from "./generate-thumbnail";
import { handleSetProcessedUrl } from "./set-processed-url";
import { handleExtractText } from "./extract-text";
import {
  handleAiSummarize,
  handleAiTag,
  handleAiQualityCheck,
  handleAiDetectLanguage,
} from "./ai-stages";
import { handleComplete } from "./complete";

const STAGE_HANDLERS: Record<PipelineStage, StageHandler> = {
  generate_thumbnail: handleGenerateThumbnail,
  set_processed_url: handleSetProcessedUrl,
  extract_text: handleExtractText,
  ai_summarize: handleAiSummarize,
  ai_tag: handleAiTag,
  ai_quality_check: handleAiQualityCheck,
  ai_detect_language: handleAiDetectLanguage,
  complete: handleComplete,
};

/**
 * Get the handler function for a pipeline stage.
 * Throws if the stage name is not registered.
 */
export function getStageHandler(stage: PipelineStage): StageHandler {
  const handler = STAGE_HANDLERS[stage];
  if (!handler) {
    throw new Error(`No handler registered for pipeline stage: ${stage}`);
  }
  return handler;
}
