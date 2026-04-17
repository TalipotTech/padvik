/**
 * Pipeline stage: set_processed_url
 *
 * For MVP: pass-through — processedUrl = original mediaUrl.
 * No transcoding. Sets a flag for future HLS transcoding (video).
 *
 * When ready for production:
 * - Video: Use AWS MediaConvert for HLS adaptive (360p, 480p, 720p)
 * - Audio: Optional normalization / format conversion
 */

import type { PipelineContext } from "../types";

export async function handleSetProcessedUrl(ctx: PipelineContext): Promise<void> {
  const mediaUrl = ctx.content.mediaUrl;
  if (!mediaUrl) return;

  // MVP: serve original file directly
  ctx.result.processedUrl = mediaUrl;

  // Flag for future transcoding when moving to AWS MediaConvert
  if (ctx.content.contentType === "video") {
    ctx.metadata.transcodingTodo = true;
    // Future HLS config placeholder
    ctx.metadata.transcodingConfig = {
      pending: true,
      profiles: ["360p_500kbps", "480p_1mbps", "720p_2.5mbps"],
      format: "hls",
    };
  }
}
