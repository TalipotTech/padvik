import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { userVideos } from "@/db/schema/learn";
import { eq, and } from "drizzle-orm";
import { z } from "zod/v4";

/**
 * GET /api/learn/videos?topicId=14
 * POST /api/learn/videos — Add YouTube video to topic
 * DELETE /api/learn/videos?id=5
 */

export async function GET(request: NextRequest) {
  let userId: number | null = null;
  try { const s = await auth(); userId = s?.user?.id ? Number(s.user.id) : null; } catch { /* auth failed */ }
  if (!userId && process.env.NODE_ENV === "development") userId = 1;
  if (!userId) {
    return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Login required" } }, { status: 401 });
  }
  const topicId = request.nextUrl.searchParams.get("topicId");
  if (!topicId) {
    return NextResponse.json({ success: false, error: { code: "MISSING_PARAM", message: "topicId required" } }, { status: 400 });
  }

  const videos = await db.select().from(userVideos)
    .where(and(eq(userVideos.userId, userId), eq(userVideos.topicId, parseInt(topicId, 10))))
    .orderBy(userVideos.sortOrder);

  return NextResponse.json({ success: true, data: videos });
}

const videoSchema = z.object({
  topicId: z.number().int(),
  youtubeUrl: z.string().url().refine((url) => {
    return url.includes("youtube.com") || url.includes("youtu.be");
  }, "Must be a YouTube URL"),
  title: z.string().optional(),
});

function extractYouTubeId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/,
    /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/live\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
  ];
  for (const p of patterns) {
    const match = url.match(p);
    if (match) return match[1];
  }
  return null;
}

export async function POST(request: NextRequest) {
  let userId: number | null = null;
  try { const s = await auth(); userId = s?.user?.id ? Number(s.user.id) : null; } catch { /* auth failed */ }
  if (!userId && process.env.NODE_ENV === "development") userId = 1;
  if (!userId) {
    return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Login required" } }, { status: 401 });
  }

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ success: false, error: { code: "INVALID_JSON", message: "Invalid JSON" } }, { status: 400 });
  }
  const parsed = videoSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } }, { status: 400 });
  }

  const videoId = extractYouTubeId(parsed.data.youtubeUrl);
  const thumbnailUrl = videoId ? `https://img.youtube.com/vi/${videoId}/mqdefault.jpg` : null;

  const [created] = await db.insert(userVideos).values({
    userId,
    topicId: parsed.data.topicId,
    youtubeUrl: parsed.data.youtubeUrl,
    title: parsed.data.title ?? null,
    thumbnailUrl,
  }).returning();

  return NextResponse.json({ success: true, data: created }, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  let userId: number | null = null;
  try { const s = await auth(); userId = s?.user?.id ? Number(s.user.id) : null; } catch { /* auth failed */ }
  if (!userId && process.env.NODE_ENV === "development") userId = 1;
  if (!userId) {
    return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Login required" } }, { status: 401 });
  }
  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ success: false, error: { code: "MISSING_PARAM", message: "id required" } }, { status: 400 });

  await db.delete(userVideos).where(and(eq(userVideos.id, parseInt(id, 10)), eq(userVideos.userId, userId)));
  return NextResponse.json({ success: true });
}
