import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { z } from "zod/v4";
import { db } from "@/db";
import { contentItems } from "@/db/schema/content";
import { eq, and, desc } from "drizzle-orm";

const foundationSchema = z.object({
  topicId: z.number().int(),
});

/**
 * GET /api/learn/foundations?topicId=X
 * Returns existing shared foundation content if it exists.
 */
export async function GET(request: NextRequest) {
  const topicIdParam = request.nextUrl.searchParams.get("topicId");
  if (!topicIdParam) {
    return NextResponse.json(
      { success: false, error: { code: "MISSING_PARAM", message: "topicId required" } },
      { status: 400 }
    );
  }

  const topicId = Number(topicIdParam);

  try {
    const [existing] = await db
      .select({
        id: contentItems.id,
        title: contentItems.title,
        body: contentItems.body,
        metadata: contentItems.metadata,
        createdAt: contentItems.createdAt,
      })
      .from(contentItems)
      .where(
        and(
          eq(contentItems.topicId, topicId),
          eq(contentItems.contentType, "foundation"),
          eq(contentItems.isPublished, true)
        )
      )
      .orderBy(desc(contentItems.createdAt))
      .limit(1);

    if (!existing) {
      return NextResponse.json({ success: true, data: null });
    }

    return NextResponse.json({
      success: true,
      data: {
        id: existing.id,
        title: existing.title,
        body: existing.body,
        cached: true,
        prerequisiteCount: 0,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: { code: "QUERY_ERROR", message } },
      { status: 500 }
    );
  }
}

/**
 * POST /api/learn/foundations
 * Generates foundation content (or returns cached shared version).
 * Saves to content_items (shared) and userNotes (personal journal).
 */
export async function POST(request: NextRequest) {
  let userId: number | null = null;
  try {
    const s = await auth();
    userId = s?.user?.id ? Number(s.user.id) : null;
  } catch {
    /* auth failed */
  }
  if (!userId && process.env.NODE_ENV === "development") userId = 1;
  if (!userId) {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Login required" } },
      { status: 401 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "INVALID_JSON", message: "Invalid JSON" } },
      { status: 400 }
    );
  }

  const parsed = foundationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } },
      { status: 400 }
    );
  }

  try {
    const { getOrBuildFoundation } = await import("@/lib/ai/foundation-builder");
    const result = await getOrBuildFoundation(parsed.data.topicId, userId);

    return NextResponse.json({
      success: true,
      data: {
        id: result.contentItemId,
        title: result.title,
        body: result.body,
        cached: result.cached,
        prerequisiteCount: result.prerequisiteCount,
        tokens: result.tokens,
        costUsd: result.costUsd,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[FoundationsAPI] Error:", message);
    return NextResponse.json(
      { success: false, error: { code: "AI_ERROR", message } },
      { status: 500 }
    );
  }
}
