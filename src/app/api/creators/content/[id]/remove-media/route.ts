import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { creatorContent } from "@/db/schema/creators";
import { eq } from "drizzle-orm";
import { checkCreator } from "@/lib/check-creator";
import {
  type MediaItem,
  dominantContentType,
  primaryMediaUrl,
  primaryFileUploadId,
  synthesizeFromLegacy,
} from "@/lib/media-items";

// ---------------------------------------------------------------------------
// POST /api/creators/content/[id]/remove-media
// Remove a specific media item by order index
// Body: { order: number }
// ---------------------------------------------------------------------------
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const creator = await checkCreator();
  if (!creator?.isCreator) {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Creator login required" } },
      { status: 401 }
    );
  }

  const { id } = await params;
  const contentId = Number(id);
  const userId = creator.userId;

  const [existing] = await db.select().from(creatorContent).where(eq(creatorContent.id, contentId)).limit(1);
  if (!existing || existing.creatorId !== userId) {
    return NextResponse.json(
      { success: false, error: { code: "NOT_FOUND", message: "Content not found" } },
      { status: 404 }
    );
  }

  let body;
  try { body = await request.json(); } catch {
    return NextResponse.json({ success: false, error: { code: "INVALID_JSON", message: "Invalid JSON" } }, { status: 400 });
  }

  const removeOrder = body.order;
  const meta = (existing.metadata as Record<string, unknown>) || {};
  let items: MediaItem[] = (meta.mediaItems as MediaItem[]) || [];
  if (items.length === 0 && (meta.imageUrls as string[])?.length) {
    items = synthesizeFromLegacy(meta);
  }

  if (typeof removeOrder !== "number" || removeOrder < 0 || removeOrder >= items.length) {
    return NextResponse.json(
      { success: false, error: { code: "INVALID_ORDER", message: `Order must be 0-${items.length - 1}` } },
      { status: 400 }
    );
  }

  const removedItem = items[removeOrder];

  // Remove and re-number
  const remaining = items.filter((_, i) => i !== removeOrder).map((item, i) => ({ ...item, order: i }));

  // Rebuild body — remove OCR text block for the removed item if it was an image with extractedText
  let updatedBody = existing.body || "";
  if (removedItem.type === "image" && removedItem.extractedText) {
    // Try to remove the text block containing the extracted text
    const sections = updatedBody.split(/\n---\n/);
    const filtered = sections.filter(s => {
      // If this section contains the image URL reference, remove it
      if (removedItem.url && s.includes(removedItem.url)) return false;
      // If this section matches the extracted text closely, remove it
      if (removedItem.extractedText && s.includes(removedItem.extractedText.substring(0, 50))) return false;
      return true;
    });
    updatedBody = filtered.join("\n---\n");
  }

  const [updated] = await db.update(creatorContent).set({
    body: updatedBody,
    mediaUrl: primaryMediaUrl(remaining),
    fileUploadId: primaryFileUploadId(remaining),
    contentType: dominantContentType(remaining, !!updatedBody),
    metadata: {
      ...meta,
      mediaItems: remaining,
      imageUrls: remaining.filter(i => i.type === "image").map(i => i.url),
      imageUploadIds: remaining.filter(i => i.type === "image").map(i => i.fileUploadId),
      pageCount: remaining.filter(i => i.type === "image").length,
    },
    updatedAt: new Date(),
  }).where(eq(creatorContent.id, contentId)).returning();

  return NextResponse.json({
    success: true,
    data: updated,
    message: `Removed ${removedItem.type} "${removedItem.fileName}". ${remaining.length} items remaining.`,
  });
}
