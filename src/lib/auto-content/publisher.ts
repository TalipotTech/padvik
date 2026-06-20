/**
 * Auto-content publisher — turns generator output into a published (or
 * pending-review) creator_content row owned by the "Padvik Official" system
 * creator, links it back to the auto_content_jobs row, and bumps the system
 * creator's content count on publish.
 *
 * Audio is uploaded to storage (S3 / local) first; text notes and question
 * sets are stored inline as JSON in the content body.
 */
import { db } from "@/db";
import { creatorContent, creatorProfiles } from "@/db/schema/creators";
import { autoContentJobs } from "@/db/schema/auto-content";
import { uploadToStorage } from "@/lib/s3";
import { eq, sql } from "drizzle-orm";
import type { ContentBlock } from "@/lib/explainer/types";
import type { GeneratedQuestion } from "./generators/question-set";
import type { ContentGenerationType } from "./types";

export interface PublishAutoContentParams {
  jobId: bigint;
  topicId: bigint;
  boardId: bigint;
  standardId: bigint;
  subjectId: bigint;
  chapterId?: bigint;
  contentType: "text_note" | "audio_explainer" | "question_set" | "video_lesson";
  title: string;

  // For text notes
  blocks?: ContentBlock[];

  // For audio
  audioBuffer?: Buffer;
  audioMimeType?: string; // "audio/mpeg" (ElevenLabs/Google) or "audio/wav" (Sarvam)
  transcript?: string;
  durationSecs?: number;

  // For question sets
  questions?: GeneratedQuestion[];

  // For curated video (external URL — not uploaded to storage)
  videoUrl?: string;
  thumbnailUrl?: string;
  videoChannel?: string;

  // Generation metadata
  model: string;
  costUsd: number;
  autoApprove: boolean;

  /** Content language (defaults to "en"). */
  language?: string;
}

/** Visual block types that satisfy the text-note auto-approve rule. */
const VISUAL_BLOCK_TYPES = new Set<ContentBlock["type"]>([
  "diagram",
  "formula",
  "comparison",
  "analogy",
]);

const SUMMARY_MAX_CHARS = 200;

/**
 * Decide whether a generated content item is safe to publish without human
 * review.
 *   - question_set    → always (low risk; students self-validate by attempting)
 *   - text_note       → only if >= 5 blocks AND at least one visual block
 *   - audio_explainer → never (TTS quality needs a human ear)
 *   - video_lesson    → never (highest visibility — always review)
 */
export function shouldAutoApprove(
  contentType: ContentGenerationType,
  blocks?: ContentBlock[],
  _questions?: GeneratedQuestion[]
): boolean {
  switch (contentType) {
    case "question_set":
      return true;
    case "text_note": {
      if (!blocks || blocks.length < 5) return false;
      return blocks.some((b) => VISUAL_BLOCK_TYPES.has(b.type));
    }
    case "audio_explainer":
    case "video_lesson":
    default:
      return false;
  }
}

/** Map our generation type to the creator_content.content_type vocabulary. */
function toCreatorContentType(contentType: PublishAutoContentParams["contentType"]): string {
  switch (contentType) {
    case "text_note":
      return "note";
    case "audio_explainer":
      return "audio";
    case "question_set":
      return "question_set";
    case "video_lesson":
      return "video";
  }
}

/** Flatten content blocks into plain text for the AI summary. */
function blocksToText(blocks: ContentBlock[]): string {
  return blocks
    .map((b) => {
      switch (b.type) {
        case "heading":
        case "text":
        case "callout":
          return b.content;
        case "formula":
          return b.latex;
        case "steps":
          return b.items.join(" ");
        case "comparison":
          return `${b.leftLabel}: ${b.left}. ${b.rightLabel}: ${b.right}`;
        case "analogy":
          return `${b.source} is like ${b.target}`;
        default:
          return "";
      }
    })
    .filter(Boolean)
    .join(" ");
}

/** Build the body string + a text source for the AI summary. */
function buildBodyAndSummarySource(params: PublishAutoContentParams): {
  body: string | null;
  summarySource: string;
} {
  switch (params.contentType) {
    case "text_note": {
      const blocks = params.blocks ?? [];
      return { body: JSON.stringify(blocks), summarySource: blocksToText(blocks) };
    }
    case "question_set": {
      const questions = params.questions ?? [];
      return {
        body: JSON.stringify(questions),
        summarySource: questions.map((q) => q.questionText).join(" "),
      };
    }
    case "audio_explainer": {
      const transcript = params.transcript ?? "";
      // Store the transcript as the body too — gives a text fallback while the
      // audio is unavailable ("Audio coming soon").
      return { body: transcript || null, summarySource: transcript };
    }
    case "video_lesson": {
      // Curated video — the URL/thumbnail live in their own columns; no body.
      return {
        body: null,
        summarySource: params.videoChannel ? `Curated video from ${params.videoChannel}` : "",
      };
    }
  }
}

/**
 * Publish generated content under the Padvik Official creator account.
 * Returns the new creator_content id.
 */
export async function publishAutoContent(
  params: PublishAutoContentParams
): Promise<{ contentId: bigint }> {
  // 1. System creator id
  const rawCreatorId = process.env.PADVIK_SYSTEM_CREATOR_ID;
  const systemCreatorId = rawCreatorId ? Number(rawCreatorId) : NaN;
  if (!rawCreatorId || Number.isNaN(systemCreatorId)) {
    throw new Error("PADVIK_SYSTEM_CREATOR_ID not configured");
  }

  const language = params.language ?? "en";
  const ccContentType = toCreatorContentType(params.contentType);
  const { body, summarySource } = buildBodyAndSummarySource(params);
  const aiSummary = summarySource.slice(0, SUMMARY_MAX_CHARS) || null;

  // 2. Audio → upload to storage first (network, outside the DB transaction)
  let mediaUrl: string | null = null;
  let thumbnailUrl: string | null = null;
  let originalFileName: string | null = null;
  let originalFileSizeBytes: number | null = null;
  let originalFileType: string | null = null;
  let durationSeconds: number | null = null;
  let aiTranscript: string | null = null;

  if (params.contentType === "video_lesson") {
    // Curated external video — store the URL directly, no storage upload.
    mediaUrl = params.videoUrl ?? null;
    thumbnailUrl = params.thumbnailUrl ?? null;
    durationSeconds = params.durationSecs ?? null;
  }

  if (params.contentType === "audio_explainer") {
    aiTranscript = params.transcript ?? null;
    durationSeconds = params.durationSecs ?? null;
    if (params.audioBuffer) {
      const mime = params.audioMimeType ?? "audio/mpeg";
      const ext = mime.includes("wav") ? "wav" : "mp3";
      const timestamp = Date.now();
      originalFileName = `audio-${timestamp}.${ext}`;
      const key = `auto-content/${Number(params.topicId)}/${originalFileName}`;
      mediaUrl = await uploadToStorage(key, params.audioBuffer, mime);
      originalFileSizeBytes = params.audioBuffer.length;
      originalFileType = mime;
    }
  }

  const autoApprove = params.autoApprove;
  const now = new Date();
  const jobIdNum = Number(params.jobId);

  // Column values shared by insert and in-place update.
  const contentValues = {
    creatorId: systemCreatorId,
    contentType: ccContentType,
    title: params.title,
    body,
    mediaUrl,
    thumbnailUrl,
    // processed URL == our uploaded media; null for externally-hosted video
    processedUrl: params.contentType === "video_lesson" ? null : mediaUrl,
    durationSeconds,
    boardId: Number(params.boardId),
    standardId: Number(params.standardId),
    subjectId: Number(params.subjectId),
    chapterId: params.chapterId != null ? Number(params.chapterId) : null,
    topicId: Number(params.topicId),
    isPremium: false, // all auto-content is free
    language,
    uploadStatus: "ready",
    reviewStatus: autoApprove ? "approved" : "pending",
    isPublished: autoApprove,
    publishedAt: autoApprove ? now : null,
    aiSummary,
    aiTranscript,
    aiLanguage: language,
    originalFileName,
    originalFileType,
    originalFileSizeBytes,
    metadata: {
      sourceType: "ai_generated",
      autoContent: true,
      jobId: jobIdNum,
      generationModel: params.model,
      generationCostUsd: params.costUsd,
    },
  };

  // 3-7. DB writes in a single transaction
  const contentIdNum = await db.transaction(async (tx) => {
    // Re-runs reuse the job's existing content row instead of inserting a new
    // one (which would orphan the old row). Look up what this job already has.
    const [jobRow] = await tx
      .select({ contentId: autoContentJobs.contentId })
      .from(autoContentJobs)
      .where(eq(autoContentJobs.id, jobIdNum))
      .limit(1);

    let contentId: number | null = null;
    let wasPublished = false;

    if (jobRow?.contentId != null) {
      const [prev] = await tx
        .select({ isPublished: creatorContent.isPublished })
        .from(creatorContent)
        .where(eq(creatorContent.id, jobRow.contentId))
        .limit(1);
      if (prev) {
        // 5a. Update the existing content row in place.
        await tx
          .update(creatorContent)
          .set({ ...contentValues, updatedAt: now })
          .where(eq(creatorContent.id, jobRow.contentId));
        contentId = jobRow.contentId;
        wasPublished = prev.isPublished;
      }
    }

    if (contentId == null) {
      // 5b. First publish for this job — insert a fresh row.
      const [content] = await tx
        .insert(creatorContent)
        .values(contentValues)
        .returning({ id: creatorContent.id });
      contentId = content.id;
    }

    // 6. Link the job row
    await tx
      .update(autoContentJobs)
      .set({
        contentId,
        status: autoApprove ? "published" : "reviewing",
        autoApproved: autoApprove,
        updatedAt: now,
      })
      .where(eq(autoContentJobs.id, jobIdNum));

    // 7. Bump the creator's content count only on the transition into published
    //    (so re-runs of already-published content don't double-count).
    if (autoApprove && !wasPublished) {
      await tx
        .update(creatorProfiles)
        .set({ contentCount: sql`${creatorProfiles.contentCount} + 1`, updatedAt: now })
        .where(eq(creatorProfiles.userId, systemCreatorId));
    }

    return contentId;
  });

  // 8. Return the content id
  return { contentId: BigInt(contentIdNum) };
}
