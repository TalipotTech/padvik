import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { creatorContent } from "@/db/schema/creators";
import { eq } from "drizzle-orm";
import { getSignedUrl, isS3Enabled } from "@/lib/s3";

// GET /api/content/[id]/stream — Get signed streaming URL for video/audio
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Login required" } }, { status: 401 });

  const { id } = await params;
  const contentId = Number(id);

  const [content] = await db.select({
    id: creatorContent.id,
    mediaUrl: creatorContent.mediaUrl,
    contentType: creatorContent.contentType,
    isPremium: creatorContent.isPremium,
    isPublished: creatorContent.isPublished,
  }).from(creatorContent).where(eq(creatorContent.id, contentId)).limit(1);

  if (!content || !content.isPublished) {
    return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "Content not found" } }, { status: 404 });
  }

  if (!content.mediaUrl) {
    return NextResponse.json({ success: false, error: { code: "NO_MEDIA", message: "No media file available" } }, { status: 404 });
  }

  // For S3: generate signed URL (4-hour expiry)
  // For local: return the direct URL
  let streamUrl = content.mediaUrl;

  if (isS3Enabled() && content.mediaUrl.includes("s3.")) {
    // Extract S3 key from URL
    const url = new URL(content.mediaUrl);
    const key = url.pathname.substring(1); // remove leading /
    streamUrl = await getSignedUrl(key, 4 * 60 * 60); // 4 hours
  }

  return NextResponse.json({
    success: true,
    data: {
      streamUrl,
      contentType: content.contentType,
      expiresIn: isS3Enabled() ? 14400 : null, // 4 hours in seconds
    },
  });
}
