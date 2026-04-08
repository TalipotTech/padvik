import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { contentItems } from "@/db/schema/content";
import { topics, chapters, subjects, standards, boards } from "@/db/schema/curriculum";
import { eq, and, desc, sql } from "drizzle-orm";
import { z } from "zod/v4";

/**
 * GET /api/admin/content-review — List pending content items
 * POST /api/admin/content-review — Approve/reject/flag a content item
 */

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Admin access required" } },
      { status: 403 }
    );
  }

  const url = new URL(request.url);
  const status = url.searchParams.get("status") ?? "pending";
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10), 200);
  const offset = parseInt(url.searchParams.get("offset") ?? "0", 10);

  const items = await db
    .select({
      id: contentItems.id,
      topicId: contentItems.topicId,
      contentType: contentItems.contentType,
      title: contentItems.title,
      body: contentItems.body,
      bodyFormat: contentItems.bodyFormat,
      sourceType: contentItems.sourceType,
      sourceUrl: contentItems.sourceUrl,
      language: contentItems.language,
      qualityScore: contentItems.qualityScore,
      reviewStatus: contentItems.reviewStatus,
      isPublished: contentItems.isPublished,
      metadata: contentItems.metadata,
      createdAt: contentItems.createdAt,
      topicTitle: topics.title,
      chapterTitle: chapters.title,
      subjectName: subjects.name,
      grade: standards.grade,
      boardCode: boards.code,
    })
    .from(contentItems)
    .innerJoin(topics, eq(topics.id, contentItems.topicId))
    .innerJoin(chapters, eq(chapters.id, topics.chapterId))
    .innerJoin(subjects, eq(subjects.id, chapters.subjectId))
    .innerJoin(standards, eq(standards.id, subjects.standardId))
    .innerJoin(boards, eq(boards.id, standards.boardId))
    .where(eq(contentItems.reviewStatus, status))
    .orderBy(desc(contentItems.createdAt))
    .limit(limit)
    .offset(offset);

  // Count total pending
  const [countResult] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(contentItems)
    .where(eq(contentItems.reviewStatus, status));

  return NextResponse.json({
    success: true,
    data: {
      items,
      total: countResult?.count ?? 0,
      limit,
      offset,
    },
  });
}

const reviewSchema = z.object({
  id: z.number().int(),
  action: z.enum(["approve", "reject", "flag"]),
});

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Admin access required" } },
      { status: 403 }
    );
  }

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ success: false, error: { code: "INVALID_JSON", message: "Invalid JSON" } }, { status: 400 });
  }

  const parsed = reviewSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } }, { status: 400 });
  }

  const { id, action } = parsed.data;
  const statusMap = { approve: "approved", reject: "rejected", flag: "flagged" } as const;
  const newStatus = statusMap[action];
  const isPublished = action === "approve";

  await db
    .update(contentItems)
    .set({
      reviewStatus: newStatus,
      isPublished,
      reviewedBy: session.user.id ? Number(session.user.id) : null,
      updatedAt: new Date(),
    })
    .where(eq(contentItems.id, id));

  return NextResponse.json({ success: true, data: { id, reviewStatus: newStatus, isPublished } });
}
