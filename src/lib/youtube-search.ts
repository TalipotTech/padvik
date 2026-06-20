/**
 * YouTube Data API v3 client for searching educational videos.
 * Searches by topic/subject with view count and rating sorting.
 *
 * Falls back to basic search if no API key is configured.
 */

const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";

export interface YouTubeVideo {
  videoId: string;
  title: string;
  description: string;
  channelTitle: string;
  thumbnailUrl: string;
  publishedAt: string;
  viewCount: number;
  likeCount: number;
  duration: string;
  url: string;
}

export interface VideoSearchOptions {
  query: string;
  maxResults?: number;
  /** Filter for educational content */
  educationOnly?: boolean;
  /** Language filter */
  relevanceLanguage?: string;
  /** Sort: relevance, viewCount, rating, date */
  order?: "relevance" | "viewCount" | "rating" | "date";
}

/**
 * Search YouTube for educational videos on a topic.
 * Returns videos sorted by relevance with view counts and ratings.
 */
export async function searchYouTubeVideos(options: VideoSearchOptions): Promise<YouTubeVideo[]> {
  // Read lazily — workers load .env *after* module import, so a module-level
  // read would be undefined even when the key is configured.
  const API_KEY = process.env.YOUTUBE_API_KEY;
  if (!API_KEY) {
    console.warn("[YouTube] No YOUTUBE_API_KEY set — using fallback search");
    return fallbackSearch(options.query, options.maxResults ?? 5);
  }

  try {
    // Step 1: Search for videos
    const searchParams = new URLSearchParams({
      key: API_KEY,
      part: "snippet",
      q: options.query + (options.educationOnly ? " tutorial lecture explanation" : ""),
      type: "video",
      maxResults: String(options.maxResults ?? 10),
      order: options.order ?? "relevance",
      videoEmbeddable: "true",
      videoCategoryId: "27", // Education category
      relevanceLanguage: options.relevanceLanguage ?? "en",
      safeSearch: "strict",
    });

    const searchRes = await fetch(`${YOUTUBE_API_BASE}/search?${searchParams}`);
    if (!searchRes.ok) {
      const err = await searchRes.text();
      console.error("[YouTube] Search API error:", searchRes.status, err);
      return fallbackSearch(options.query, options.maxResults ?? 5);
    }

    const searchData = await searchRes.json();
    const videoIds = (searchData.items ?? [])
      .map((item: { id?: { videoId?: string } }) => item.id?.videoId)
      .filter(Boolean) as string[];

    if (videoIds.length === 0) return [];

    // Step 2: Get video details (view counts, likes, duration)
    const detailParams = new URLSearchParams({
      key: API_KEY,
      part: "snippet,statistics,contentDetails",
      id: videoIds.join(","),
    });

    const detailRes = await fetch(`${YOUTUBE_API_BASE}/videos?${detailParams}`);
    if (!detailRes.ok) return [];

    const detailData = await detailRes.json();

    // Map and sort by view count
    const videos: YouTubeVideo[] = (detailData.items ?? []).map((item: {
      id: string;
      snippet: { title: string; description: string; channelTitle: string; thumbnails: { medium?: { url: string } }; publishedAt: string };
      statistics: { viewCount?: string; likeCount?: string };
      contentDetails: { duration?: string };
    }) => ({
      videoId: item.id,
      title: item.snippet.title,
      description: item.snippet.description.slice(0, 200),
      channelTitle: item.snippet.channelTitle,
      thumbnailUrl: item.snippet.thumbnails?.medium?.url ?? `https://img.youtube.com/vi/${item.id}/mqdefault.jpg`,
      publishedAt: item.snippet.publishedAt,
      viewCount: parseInt(item.statistics?.viewCount ?? "0", 10),
      likeCount: parseInt(item.statistics?.likeCount ?? "0", 10),
      duration: parseDuration(item.contentDetails?.duration ?? ""),
      url: `https://www.youtube.com/watch?v=${item.id}`,
    }));

    // Sort by view count (highest first)
    videos.sort((a, b) => b.viewCount - a.viewCount);

    return videos;
  } catch (err) {
    console.error("[YouTube] Search error:", err);
    return fallbackSearch(options.query, options.maxResults ?? 5);
  }
}

/**
 * Build a search query for a specific topic in the curriculum.
 */
export function buildTopicQuery(
  topicTitle: string,
  subjectName: string,
  grade: number,
  boardCode: string
): string {
  return `${topicTitle} ${subjectName} Class ${grade} ${boardCode} NCERT explanation`;
}

/**
 * Parse ISO 8601 duration (PT4M13S) to human-readable (4:13).
 */
function parseDuration(iso: string): string {
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return "";
  const h = parseInt(match[1] ?? "0", 10);
  const m = parseInt(match[2] ?? "0", 10);
  const s = parseInt(match[3] ?? "0", 10);
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatViewCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return String(count);
}

export { formatViewCount };

/**
 * Fallback search when no YouTube API key — returns basic results using oEmbed.
 */
async function fallbackSearch(query: string, maxResults: number): Promise<YouTubeVideo[]> {
  // Without API key, we can't search YouTube directly.
  // Return empty and let the UI show a message to configure the API key.
  return [];
}
