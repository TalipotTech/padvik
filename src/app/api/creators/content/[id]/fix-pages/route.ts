import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { creatorContent } from "@/db/schema/creators";
import { eq } from "drizzle-orm";
import { checkCreator } from "@/lib/check-creator";

// ---------------------------------------------------------------------------
// POST /api/creators/content/[id]/fix-pages
// Fix corrupted page data: remove duplicate page (the 3rd page that was
// created by the old buggy append-instead-of-replace flow).
// Body: { removePageIndex: number } — 0-based index of the page to remove
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

  const [existing] = await db
    .select()
    .from(creatorContent)
    .where(eq(creatorContent.id, contentId))
    .limit(1);

  if (!existing || existing.creatorId !== userId) {
    return NextResponse.json(
      { success: false, error: { code: "NOT_FOUND", message: "Content not found" } },
      { status: 404 }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "INVALID_JSON", message: "Invalid JSON" } },
      { status: 400 }
    );
  }

  const removeIndex = body.removePageIndex;
  const meta = (existing.metadata as Record<string, unknown>) || {};
  const imageUrls: string[] = (meta.imageUrls as string[]) || [];
  const uploadIds: number[] = (meta.imageUploadIds as number[]) || [];

  if (typeof removeIndex !== "number" || removeIndex < 0 || removeIndex >= imageUrls.length) {
    return NextResponse.json(
      { success: false, error: { code: "INVALID_INDEX", message: `Index must be 0-${imageUrls.length - 1}. Got: ${removeIndex}` } },
      { status: 400 }
    );
  }

  // Remove the page from imageUrls and uploadIds
  const newImageUrls = imageUrls.filter((_, i) => i !== removeIndex);
  const newUploadIds = uploadIds.filter((_, i) => i !== removeIndex);

  // Rebuild body — split into pages, remove the target, re-number
  const bodyText = existing.body || "";
  const pageSections = bodyText.split(/\n---\n/).map(s => s.trim()).filter(Boolean);
  pageSections.splice(removeIndex, 1);

  // Re-number page headers
  const rebuiltBody = pageSections
    .map((section, i) => {
      // Replace "## Page N" with correct number
      return section.replace(/^## Page \d+/m, `## Page ${i + 1}`);
    })
    .join("\n\n---\n\n");

  const [updated] = await db
    .update(creatorContent)
    .set({
      body: rebuiltBody,
      metadata: {
        ...meta,
        imageUrls: newImageUrls,
        imageUploadIds: newUploadIds,
        pageCount: newImageUrls.length,
      },
      updatedAt: new Date(),
    })
    .where(eq(creatorContent.id, contentId))
    .returning();

  return NextResponse.json({
    success: true,
    data: updated,
    message: `Removed page ${removeIndex + 1}. Now ${newImageUrls.length} pages.`,
  });
}
