import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { classrooms } from "@/db/schema/classrooms";
import { creatorContent } from "@/db/schema/creators";
import { boards, standards, subjects, chapters } from "@/db/schema/curriculum";
import { eq, or, sql, desc, and } from "drizzle-orm";

/**
 * GET /api/classrooms/[id]/content
 * Returns content for this classroom:
 * 1. Content explicitly assigned to this classroom (via assignedClassrooms array)
 * 2. ALL published content from the classroom's creator
 * This ensures students see the creator's full content feed when they join.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Login required" } }, { status: 401 });
  const { id } = await params;
  const classroomId = Number(id);

  // Get classroom to find the creator
  const [classroom] = await db.select({ teacherId: classrooms.teacherId })
    .from(classrooms).where(eq(classrooms.id, classroomId)).limit(1);

  if (!classroom) {
    return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "Classroom not found" } }, { status: 404 });
  }

  // Return: assigned content + all published content from this creator
  const items = await db
    .select({
      id: creatorContent.id,
      title: creatorContent.title,
      description: creatorContent.description,
      contentType: creatorContent.contentType,
      thumbnailUrl: creatorContent.thumbnailUrl,
      mediaUrl: creatorContent.mediaUrl,
      viewCount: creatorContent.viewCount,
      likeCount: creatorContent.likeCount,
      isPublished: creatorContent.isPublished,
      isPremium: creatorContent.isPremium,
      aiSummary: creatorContent.aiSummary,
      createdAt: creatorContent.createdAt,
      boardName: boards.name,
      subjectName: subjects.name,
      chapterTitle: chapters.title,
    })
    .from(creatorContent)
    .leftJoin(boards, eq(boards.id, creatorContent.boardId))
    .leftJoin(subjects, eq(subjects.id, creatorContent.subjectId))
    .leftJoin(chapters, eq(chapters.id, creatorContent.chapterId))
    .where(or(
      // Explicitly assigned to this classroom
      sql`${classroomId} = ANY(${creatorContent.assignedClassrooms})`,
      // OR all published content from the classroom's creator
      and(
        eq(creatorContent.creatorId, classroom.teacherId),
        eq(creatorContent.isPublished, true)
      )
    ))
    .orderBy(desc(creatorContent.createdAt));

  return NextResponse.json({ success: true, data: items });
}

/**
 * POST /api/classrooms/[id]/content — Assign specific content to classroom
 * This marks content as explicitly assigned (shows even if unpublished).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Login required" } }, { status: 401 });
  const { id } = await params;
  const userId = Number(session.user.id);
  const classroomId = Number(id);

  const [classroom] = await db.select({ teacherId: classrooms.teacherId }).from(classrooms).where(eq(classrooms.id, classroomId)).limit(1);
  if (!classroom || classroom.teacherId !== userId) return NextResponse.json({ success: false, error: { code: "FORBIDDEN", message: "Not your classroom" } }, { status: 403 });

  let body: { contentId: number };
  try { body = await request.json(); } catch { return NextResponse.json({ success: false, error: { code: "INVALID_JSON", message: "Invalid JSON" } }, { status: 400 }); }

  await db.update(creatorContent).set({
    assignedClassrooms: sql`array_append(${creatorContent.assignedClassrooms}, ${classroomId})`,
    updatedAt: new Date(),
  }).where(eq(creatorContent.id, body.contentId));

  return NextResponse.json({ success: true, data: { assigned: true } });
}
