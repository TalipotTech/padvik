import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { readingProgress } from "@/db/schema/learn";
import { eq, and } from "drizzle-orm";
import { z } from "zod/v4";

/**
 * POST /api/learn/progress — Mark a section as read / update reading progress
 */
const progressSchema = z.object({
  contentItemId: z.number().int(),
  sectionId: z.string().optional(),
  /** Set to 100 to mark entire content as complete */
  completionPercent: z.number().int().min(0).max(100).optional(),
  /** Seconds spent reading in this session */
  readTimeSeconds: z.number().int().min(0).optional(),
});

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

  const parsed = progressSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } }, { status: 400 });
  }

  const { contentItemId, sectionId, completionPercent, readTimeSeconds } = parsed.data;

  // Find existing progress
  const [existing] = await db
    .select()
    .from(readingProgress)
    .where(and(eq(readingProgress.userId, userId), eq(readingProgress.contentItemId, contentItemId)))
    .limit(1);

  if (existing) {
    // Update existing progress
    const sectionsRead = (existing.sectionsRead as string[]) ?? [];
    if (sectionId && !sectionsRead.includes(sectionId)) {
      sectionsRead.push(sectionId);
    }

    await db
      .update(readingProgress)
      .set({
        sectionsRead,
        completionPercent: completionPercent ?? existing.completionPercent,
        lastReadAt: new Date(),
        totalReadTimeSeconds: existing.totalReadTimeSeconds + (readTimeSeconds ?? 0),
      })
      .where(eq(readingProgress.id, existing.id));

    return NextResponse.json({ success: true, data: { id: existing.id, sectionsRead, completionPercent: completionPercent ?? existing.completionPercent } });
  } else {
    // Create new progress entry
    const sectionsRead = sectionId ? [sectionId] : [];
    const [created] = await db
      .insert(readingProgress)
      .values({
        userId,
        contentItemId,
        sectionsRead,
        completionPercent: completionPercent ?? 0,
        totalReadTimeSeconds: readTimeSeconds ?? 0,
      })
      .returning();

    return NextResponse.json({ success: true, data: created }, { status: 201 });
  }
}
