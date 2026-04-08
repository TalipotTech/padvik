import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { eq } from "drizzle-orm";
import { topics, chapters, subjects, standards, boards } from "@/db/schema/curriculum";
import { searchYouTubeVideos, buildTopicQuery, type YouTubeVideo } from "@/lib/youtube-search";
import { z } from "zod/v4";

/**
 * GET /api/learn/videos/suggest?topicId=33&query=&maxResults=10
 * Searches YouTube for educational videos related to a topic.
 * Uses topic context (subject, grade, board) to build an optimal search query.
 *
 * POST /api/learn/videos/suggest — Save a suggested video to user's collection
 */

export async function GET(request: NextRequest) {
  let userId: number | null = null;
  try { const s = await auth(); userId = s?.user?.id ? Number(s.user.id) : null; } catch {}
  if (!userId && process.env.NODE_ENV === "development") userId = 1;
  if (!userId) return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Login required" } }, { status: 401 });

  const topicId = request.nextUrl.searchParams.get("topicId");
  const customQuery = request.nextUrl.searchParams.get("query");
  const maxResults = Math.min(parseInt(request.nextUrl.searchParams.get("maxResults") ?? "10", 10), 20);

  if (!topicId && !customQuery) {
    return NextResponse.json({ success: false, error: { code: "MISSING_PARAMS", message: "topicId or query required" } }, { status: 400 });
  }

  let searchQuery = customQuery ?? "";

  // Build query from topic context if no custom query
  if (!customQuery && topicId) {
    const [topic] = await db
      .select({
        title: topics.title,
        subjectName: subjects.name,
        grade: standards.grade,
        boardCode: boards.code,
      })
      .from(topics)
      .innerJoin(chapters, eq(chapters.id, topics.chapterId))
      .innerJoin(subjects, eq(subjects.id, chapters.subjectId))
      .innerJoin(standards, eq(standards.id, subjects.standardId))
      .innerJoin(boards, eq(boards.id, standards.boardId))
      .where(eq(topics.id, parseInt(topicId, 10)))
      .limit(1);

    if (!topic) return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "Topic not found" } }, { status: 404 });

    searchQuery = buildTopicQuery(topic.title, topic.subjectName, topic.grade, topic.boardCode);
  }

  try {
    const videos = await searchYouTubeVideos({
      query: searchQuery,
      maxResults,
      educationOnly: true,
      order: "relevance",
    });

    return NextResponse.json({
      success: true,
      data: {
        query: searchQuery,
        videos,
        hasApiKey: !!process.env.YOUTUBE_API_KEY,
      },
    });
  } catch (err) {
    return NextResponse.json({
      success: false,
      error: { code: "SEARCH_ERROR", message: err instanceof Error ? err.message : "YouTube search failed" },
    }, { status: 500 });
  }
}

// Save a suggested video
const saveSchema = z.object({
  topicId: z.number().int(),
  videoId: z.string(),
  title: z.string(),
  url: z.string().url(),
  channelTitle: z.string().optional(),
  viewCount: z.number().optional(),
});

export async function POST(request: NextRequest) {
  let userId: number | null = null;
  try { const s = await auth(); userId = s?.user?.id ? Number(s.user.id) : null; } catch {}
  if (!userId && process.env.NODE_ENV === "development") userId = 1;
  if (!userId) return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Login required" } }, { status: 401 });

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ success: false, error: { code: "INVALID_JSON", message: "Invalid JSON" } }, { status: 400 });
  }
  const parsed = saveSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } }, { status: 400 });

  const { userVideos } = await import("@/db/schema/learn");

  const [created] = await db.insert(userVideos).values({
    userId,
    topicId: parsed.data.topicId,
    youtubeUrl: parsed.data.url,
    title: parsed.data.title,
    thumbnailUrl: `https://img.youtube.com/vi/${parsed.data.videoId}/mqdefault.jpg`,
  }).returning();

  return NextResponse.json({ success: true, data: created }, { status: 201 });
}
