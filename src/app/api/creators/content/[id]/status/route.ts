import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { creatorContent } from "@/db/schema/creators";
import { eq } from "drizzle-orm";

// GET /api/creators/content/[id]/status — Poll processing status
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Login required" } }, { status: 401 });
  const { id } = await params;

  const [item] = await db.select({
    uploadStatus: creatorContent.uploadStatus,
    reviewStatus: creatorContent.reviewStatus,
    aiSummary: creatorContent.aiSummary,
    aiTags: creatorContent.aiTags,
    aiQualityScore: creatorContent.aiQualityScore,
    aiLanguage: creatorContent.aiLanguage,
  }).from(creatorContent).where(eq(creatorContent.id, Number(id))).limit(1);

  if (!item) return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "Content not found" } }, { status: 404 });

  return NextResponse.json({ success: true, data: item });
}
