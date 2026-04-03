import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { chapters, topics } from "@/db/schema/curriculum";
import { eq } from "drizzle-orm";

// ---------------------------------------------------------------------------
// GET /api/syllabus/chapters/[id] — Chapter with its topics
// ---------------------------------------------------------------------------
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: raw } = await params;
  const chapterId = parseInt(raw, 10);
  if (isNaN(chapterId)) {
    return NextResponse.json(
      { success: false, error: { code: "INVALID_ID", message: "Invalid chapter ID" } },
      { status: 400 },
    );
  }

  const [chapter] = await db.select().from(chapters).where(eq(chapters.id, chapterId)).limit(1);
  if (!chapter) {
    return NextResponse.json(
      { success: false, error: { code: "NOT_FOUND", message: "Chapter not found" } },
      { status: 404 },
    );
  }

  const topicRows = await db
    .select()
    .from(topics)
    .where(eq(topics.chapterId, chapterId))
    .orderBy(topics.sortOrder);

  return NextResponse.json({
    success: true,
    data: { ...chapter, topics: topicRows },
  });
}
