import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { creatorContent } from "@/db/schema/creators";
import { eq } from "drizzle-orm";
import { checkCreator } from "@/lib/check-creator";

// POST /api/creators/content/[id]/retry — Retry failed content processing
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const creator = await checkCreator();
  if (!creator?.isCreator) return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Creator required" } }, { status: 401 });

  const { id } = await params;
  const contentId = Number(id);

  const [content] = await db
    .select({
      creatorId: creatorContent.creatorId,
      uploadStatus: creatorContent.uploadStatus,
      metadata: creatorContent.metadata,
    })
    .from(creatorContent)
    .where(eq(creatorContent.id, contentId))
    .limit(1);

  if (!content || content.creatorId !== creator.userId) {
    return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "Content not found" } }, { status: 404 });
  }

  if (content.uploadStatus !== "failed") {
    return NextResponse.json({ success: false, error: { code: "INVALID_STATE", message: "Only failed content can be retried" } }, { status: 400 });
  }

  // Clear pipeline error but keep completed stages so we resume from the failed stage
  const metadata = (content.metadata as Record<string, unknown>) ?? {};
  delete metadata.pipelineError;

  // Reset status and re-queue processing
  await db.update(creatorContent).set({
    uploadStatus: "processing",
    metadata,
    updatedAt: new Date(),
  }).where(eq(creatorContent.id, contentId));

  try {
    const { addCreatorContentJob } = await import("@/lib/queue/index");
    await addCreatorContentJob({ contentId, creatorId: creator.userId, action: "process_full" });
  } catch {
    // Queue not available — run inline
    try {
      const { processCreatorContent } = await import("@/lib/content-pipeline/processor");
      processCreatorContent(contentId).catch(() => {});
    } catch { /* ignore */ }
  }

  return NextResponse.json({ success: true, data: { retried: true, uploadStatus: "processing" } });
}
