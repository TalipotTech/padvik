/**
 * Video-lesson "generator" — curates the best existing YouTube video for a
 * topic rather than generating one. Reuses the project's YouTube search helper.
 *
 * Curation is effectively free (YouTube API quota, no AI tokens), and the
 * result always lands in review (video_lesson never auto-approves) so an admin
 * confirms the pick before it goes live.
 */
import { searchYouTubeVideos, buildTopicQuery, type YouTubeVideo } from "@/lib/youtube-search";
import { aiChat } from "@/lib/ai/provider";
import { extractJson } from "@/lib/explainer/types";
import { resolveAutoContentModel } from "../ai-config";

export interface GenerateVideoLessonParams {
  topicId: bigint;
  boardCode: string;
  standard: number;
  subject: string;
  chapter: string;
  topicName: string;
  language?: string;
  /** Explicit re-rank model override (admin-selected); falls back to default. */
  modelOverride?: string;
}

export interface GenerateVideoLessonResult {
  title: string;
  videoUrl: string | null;
  videoId: string | null;
  thumbnailUrl: string | null;
  channelTitle: string | null;
  durationSecs: number | null;
  model: string;
  costUsd: number;
  timeMs: number;
  /** Set when no suitable video could be found. */
  error: string | null;
}

// Exclude Shorts/too-short and overly long lectures; prefer videos with reach.
const MIN_DURATION_SECS = 90;
const MAX_DURATION_SECS = 45 * 60;
const MIN_VIEWS = 1000;
const SHORTLIST_SIZE = 5;

/** Parse "M:SS" / "H:MM:SS" (from the YouTube helper) into seconds. */
function durationToSeconds(d: string): number | null {
  if (!d) return null;
  const parts = d.split(":").map((p) => Number(p));
  if (parts.length === 0 || parts.some((n) => Number.isNaN(n))) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0];
}

/** Shortlist a few sensible candidates (well-viewed, reasonable length). */
function shortlistCandidates(videos: YouTubeVideo[]): YouTubeVideo[] {
  if (videos.length === 0) return [];
  // Videos arrive sorted by view count (highest first).
  const suitable = videos.filter((v) => {
    const secs = durationToSeconds(v.duration);
    const okDuration = secs == null || (secs >= MIN_DURATION_SECS && secs <= MAX_DURATION_SECS);
    return okDuration && v.viewCount >= MIN_VIEWS;
  });
  const pool = suitable.length > 0 ? suitable : videos;
  return pool.slice(0, SHORTLIST_SIZE);
}

/**
 * Re-rank the shortlist with a cheap model (Haiku) to pick the most relevant,
 * accurate, on-level video. Non-fatal — returns null on any failure so the
 * caller falls back to the top view-counted result.
 */
async function rankWithAI(
  shortlist: YouTubeVideo[],
  params: GenerateVideoLessonParams
): Promise<{ video: YouTubeVideo; costUsd: number; model: string } | null> {
  const { topicName, subject, standard, boardCode, language } = params;
  const candidates = shortlist
    .map(
      (v) =>
        `- id=${v.videoId} | "${v.title}" | channel: ${v.channelTitle} | ${v.duration} | ${v.viewCount} views | ${v.description}`
    )
    .join("\n");

  const systemPrompt =
    "You pick the single best YouTube video to teach a specific school topic. " +
    "Prefer the most accurate, on-level, clearly-explained option from a reputable educational channel, " +
    "matching the requested board and language. " +
    'Return ONLY JSON: {"videoId":"<id>","reason":"<short>"}.';
  const userPrompt =
    `Topic: ${topicName}\nSubject: ${subject}\nBoard: ${boardCode}, Class: ${standard}\n` +
    `Language: ${language || "English"}\n\nCandidates:\n${candidates}\n\n` +
    "Choose the single best videoId from the candidates above.";

  try {
    const res = await aiChat(userPrompt, {
      model: resolveAutoContentModel("video_rerank", params.modelOverride),
      systemPrompt,
      temperature: 0,
      maxTokens: 200,
      jsonOutput: true,
    });
    const parsed = extractJson(res.content) as { videoId?: string };
    const match = shortlist.find((v) => v.videoId === parsed?.videoId);
    if (!match) return null;
    return { video: match, costUsd: res.costUsd, model: `youtube-curation+${res.model}`.slice(0, 50) };
  } catch (err) {
    console.warn(
      "[auto-content:video] AI re-rank failed, using top result:",
      (err as Error).message
    );
    return null;
  }
}

/**
 * Curate a YouTube video lesson for a topic. Never throws on "not found" — it
 * returns a result with `error` set so the caller can record it on the job.
 */
export async function generateVideoLesson(
  params: GenerateVideoLessonParams
): Promise<GenerateVideoLessonResult> {
  const { boardCode, standard, subject, topicName, language } = params;
  const start = Date.now();

  const title = `Video Lesson: ${topicName} — ${boardCode} Class ${standard}`;
  const base = {
    title,
    videoUrl: null,
    videoId: null,
    thumbnailUrl: null,
    channelTitle: null,
    durationSecs: null,
    model: "youtube-curation",
    costUsd: 0,
    timeMs: 0,
  };

  let videos: YouTubeVideo[] = [];
  try {
    videos = await searchYouTubeVideos({
      query: buildTopicQuery(topicName, subject, standard, boardCode),
      maxResults: 10,
      educationOnly: true,
      relevanceLanguage: language ?? "en",
      order: "relevance",
    });
  } catch (err) {
    return {
      ...base,
      timeMs: Date.now() - start,
      error: `YouTube search failed: ${(err as Error).message}`,
    };
  }

  const shortlist = shortlistCandidates(videos);
  if (shortlist.length === 0) {
    return {
      ...base,
      timeMs: Date.now() - start,
      error:
        "No suitable YouTube video found (check YOUTUBE_API_KEY, or no education videos matched).",
    };
  }

  // Default to the top view-counted candidate; let Haiku re-rank when there's
  // a real choice to make.
  let chosen = shortlist[0];
  let costUsd = 0;
  let model = "youtube-curation";
  if (shortlist.length > 1) {
    const ranked = await rankWithAI(shortlist, params);
    if (ranked) {
      chosen = ranked.video;
      costUsd = ranked.costUsd;
      model = ranked.model;
    }
  }

  return {
    title,
    videoUrl: chosen.url,
    videoId: chosen.videoId,
    thumbnailUrl: chosen.thumbnailUrl,
    channelTitle: chosen.channelTitle,
    durationSecs: durationToSeconds(chosen.duration),
    model,
    costUsd,
    timeMs: Date.now() - start,
    error: null,
  };
}
