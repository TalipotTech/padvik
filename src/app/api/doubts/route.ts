import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { users } from "@/db/schema/auth";
import { doubts, doubtResponses } from "@/db/schema/doubts";
import { eq, and, desc, sql, ilike } from "drizzle-orm";
import { z } from "zod/v4";

// ---------------------------------------------------------------------------
// POST /api/doubts — Student creates a doubt (with optional AI auto-response)
// ---------------------------------------------------------------------------
const createSchema = z.object({
  questionText: z.string().min(3).max(5000),
  creatorId: z.number().optional(),
  contentId: z.number().optional(),
  classroomId: z.number().optional(),
  topicId: z.number().optional(),
  questionImages: z.array(z.string()).optional(),
  // Context from content page
  contextType: z.enum(["text_selection", "video_timestamp", "audio_timestamp", "pdf_page"]).optional(),
  contextText: z.string().max(2000).optional(),
  contextTimestamp: z.number().optional(),
  contextPage: z.number().optional(),
  // Answer mode: "ai" (default) or "creator" (skip AI, wait for teacher)
  answerMode: z.enum(["ai", "creator"]).optional(),
});

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Login required" } },
      { status: 401 }
    );
  }

  const userId = Number(session.user.id);

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "INVALID_JSON", message: "Invalid JSON body" } },
      { status: 400 }
    );
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } },
      { status: 400 }
    );
  }

  const { questionText, creatorId, contentId, classroomId, topicId, questionImages, contextType, contextText, contextTimestamp, contextPage, answerMode } = parsed.data;
  const useAi = answerMode !== "creator"; // default is AI mode

  // Store context info in questionImages JSONB (flexible field)
  const metadata: Record<string, unknown> = {};
  if (contextType) metadata.contextType = contextType;
  if (contextText) metadata.contextText = contextText;
  if (contextTimestamp !== undefined) metadata.contextTimestamp = contextTimestamp;
  if (contextPage !== undefined) metadata.contextPage = contextPage;

  const [doubt] = await db.insert(doubts).values({
    studentId: userId,
    creatorId: creatorId ?? null,
    contentId: contentId ?? null,
    classroomId: classroomId ?? null,
    topicId: topicId ?? null,
    questionText,
    questionImages: Object.keys(metadata).length > 0 ? { ...(questionImages || []), _context: metadata } : (questionImages ?? []),
  }).returning();

  // AI auto-response: only if AI mode selected (not teacher mode)
  if (useAi) {
    const contextHint = contextText ? `\n\nContext (selected text): "${contextText}"` : "";
    generateAiDraftResponse(doubt.id, questionText + contextHint).catch(() => {});
  }

  return NextResponse.json({ success: true, data: doubt }, { status: 201 });
}

/** Generate an AI draft response for the doubt (background, non-blocking) */
async function generateAiDraftResponse(doubtId: number, questionText: string) {
  try {
    const { aiChat, AI_MODELS } = await import("@/lib/ai/provider");
    const result = await aiChat(
      `You are a helpful educational tutor. A student asked this doubt:\n\n"${questionText}"\n\nProvide a clear, concise answer suitable for an Indian K-12 student. Use simple language. If math is involved, use LaTeX notation. Keep the response under 300 words.`,
      { model: AI_MODELS.BULK, temperature: 0.3, maxTokens: 500 }
    );

    if (result.content) {
      await db.insert(doubtResponses).values({
        doubtId,
        responderId: 1, // system user
        responseText: result.content,
        responseType: "text",
        isAi: true,
      });

      // Update doubt status to ai_answered
      await db.update(doubts).set({ status: "ai_answered", updatedAt: new Date() }).where(eq(doubts.id, doubtId));
    }
  } catch (err) {
    console.error(`[ai-doubt] Failed to generate AI response for doubt ${doubtId}:`, err instanceof Error ? err.message : err);
    // Non-critical — doubt stays as "open" for creator to answer
  }
}

// ---------------------------------------------------------------------------
// GET /api/doubts — List doubts with filters
// ---------------------------------------------------------------------------
const querySchema = z.object({
  status: z.string().optional(),
  creatorId: z.coerce.number().optional(),
  topicId: z.coerce.number().optional(),
  mine: z.enum(["true", "false"]).optional(), // show only my doubts
  search: z.string().optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(50).default(20),
});

export async function GET(request: NextRequest) {
  const session = await auth();
  const userId = session ? Number(session.user.id) : null;

  const params = Object.fromEntries(request.nextUrl.searchParams);
  const parsed = querySchema.safeParse(params);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } },
      { status: 400 }
    );
  }

  const { status, creatorId, topicId, mine, search, page, limit } = parsed.data;
  const offset = (page - 1) * limit;

  const conditions = [];
  if (status) conditions.push(eq(doubts.status, status));
  if (creatorId) conditions.push(eq(doubts.creatorId, creatorId));
  if (topicId) conditions.push(eq(doubts.topicId, topicId));
  if (mine === "true" && userId) conditions.push(eq(doubts.studentId, userId));
  if (search) conditions.push(ilike(doubts.questionText, `%${search}%`));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [items, countResult] = await Promise.all([
    db
      .select({
        id: doubts.id,
        studentId: doubts.studentId,
        creatorId: doubts.creatorId,
        contentId: doubts.contentId,
        topicId: doubts.topicId,
        questionText: doubts.questionText,
        questionImages: doubts.questionImages,
        status: doubts.status,
        upvoteCount: doubts.upvoteCount,
        createdAt: doubts.createdAt,
        studentName: users.fullName,
        studentAvatar: users.avatarUrl,
      })
      .from(doubts)
      .innerJoin(users, eq(users.id, doubts.studentId))
      .where(whereClause)
      .orderBy(desc(doubts.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(doubts)
      .where(whereClause),
  ]);

  const total = countResult[0]?.count ?? 0;

  return NextResponse.json({
    success: true,
    data: {
      items,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    },
  });
}
