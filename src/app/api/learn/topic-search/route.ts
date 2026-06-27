import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { eq, and } from "drizzle-orm";
import { z } from "zod/v4";
import { users } from "@/db/schema/auth";
import { standards, boards } from "@/db/schema/curriculum";
import { topicSearchHistory } from "@/db/schema/learning-path";
import { checkSearchScope } from "@/lib/search/scope-guard";
import { searchTopics, searchContent } from "@/lib/search/topic-search";
import { trackDemandSignal } from "@/lib/auto-content/demand-tracker";

/**
 * GET /api/learn/topic-search?q=...&boardId=...&grade=...
 *
 * The single entry the home search box calls. Composes the scope guard +
 * the shared topic/content search, records a search-history row, and tracks a
 * demand signal when a matched topic has no content. Returns the landing topic
 * + ranked topic hits; the full content/media bundle is fetched separately by
 * the results page (STEP 4) to keep this route fast.
 */

const querySchema = z.object({
  q: z.string().trim().min(2, "Search query must be at least 2 characters"),
  boardId: z.number().int().positive().nullable().optional(),
  grade: z.number().int().min(1).max(12).nullable().optional(),
});

async function getUserId(): Promise<number | null> {
  try {
    const s = await auth();
    const n = s?.user?.id ? Number(s.user.id) : NaN;
    if (Number.isFinite(n)) return n;
  } catch {
    /* auth failed */
  }
  // Non-numeric (e.g. demo login) or no session → dev fallback.
  if (process.env.NODE_ENV === "development") return 1;
  return null;
}

/** Resolve the user's saved board/grade as a fallback when params are absent. */
async function resolveUserBoardGrade(
  userId: number
): Promise<{ boardId: number | null; grade: number | null; boardCode: string | null }> {
  const [user] = await db
    .select({ boardId: users.boardId, standardId: users.standardId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) return { boardId: null, grade: null, boardCode: null };

  let grade: number | null = null;
  let boardCode: string | null = null;
  if (user.standardId) {
    const [std] = await db
      .select({ grade: standards.grade, boardCode: boards.code })
      .from(standards)
      .innerJoin(boards, eq(boards.id, standards.boardId))
      .where(eq(standards.id, user.standardId))
      .limit(1);
    if (std) {
      grade = std.grade;
      boardCode = std.boardCode;
    }
  }
  return { boardId: user.boardId ?? null, grade, boardCode };
}

async function boardCodeFor(boardId: number | null): Promise<string | null> {
  if (!boardId) return null;
  const [row] = await db
    .select({ code: boards.code })
    .from(boards)
    .where(eq(boards.id, boardId))
    .limit(1);
  return row?.code ?? null;
}

export async function GET(request: NextRequest) {
  const userId = await getUserId();
  if (!userId) {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Login required" } },
      { status: 401 }
    );
  }

  const sp = request.nextUrl.searchParams;
  const parsed = querySchema.safeParse({
    q: sp.get("q") ?? "",
    boardId: sp.get("boardId") ? Number(sp.get("boardId")) : undefined,
    grade: sp.get("grade") ? Number(sp.get("grade")) : undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } },
      { status: 400 }
    );
  }

  let { boardId, grade } = parsed.data;
  const q = parsed.data.q;

  // Fall back to the user's saved selection when the box didn't pass context.
  let boardCode: string | null = null;
  if (boardId == null || grade == null) {
    const fallback = await resolveUserBoardGrade(userId);
    boardId = boardId ?? fallback.boardId;
    grade = grade ?? fallback.grade;
    boardCode = fallback.boardCode;
  }
  if (!boardCode && boardId != null) {
    boardCode = await boardCodeFor(boardId);
  }

  // --- Scope guard ---------------------------------------------------------
  const scope = await checkSearchScope(q, {
    boardCode: boardCode ?? undefined,
    grade: grade ?? undefined,
  });

  if (!scope.allowed) {
    await db
      .insert(topicSearchHistory)
      .values({
        userId,
        query: q.slice(0, 500),
        matchedTopicId: null,
        boardId: boardId ?? null,
        grade: grade ?? null,
        resultCount: 0,
        wasRejected: true,
      })
      .catch(() => {});

    return NextResponse.json({
      success: true,
      data: {
        rejected: true,
        reason: scope.reason ?? "Padvik search is only for your syllabus topics.",
        landingTopicId: null,
        topics: [],
        content: [],
      },
    });
  }

  // --- Allowed: run both searches in parallel ------------------------------
  const [topicHits, contentHits] = await Promise.all([
    searchTopics(q, { boardId, grade, limit: 20 }),
    searchContent(q, { boardId, grade, limit: 20 }),
  ]);

  // Landing topic = best topic match, else the topic of the best content match.
  const landingTopicId =
    topicHits[0]?.topicId ?? contentHits[0]?.topicId ?? null;

  const resultCount = topicHits.length + contentHits.length;

  // Record the search.
  await db
    .insert(topicSearchHistory)
    .values({
      userId,
      query: q.slice(0, 500),
      matchedTopicId: landingTopicId,
      boardId: boardId ?? null,
      grade: grade ?? null,
      resultCount,
      wasRejected: false,
    })
    .catch(() => {});

  // Track search demand on EVERY search — this is the "search ranking" that the
  // cron-driven auto-content agent consumes (calculateDemandScores →
  // getTopDemandTopics → runContentGenerationCycle). A miss (no published
  // content) is the strongest signal; a hit still counts (it ranks the topic and
  // unlocks heavier content types like audio/video on sustained interest).
  // getTopDemandTopics already excludes topics that have Padvik content, so
  // tracking hits never causes duplicate generation. Guard so it never throws.
  if (landingTopicId != null) {
    const weight = contentHits.length === 0 ? 2.0 : 1.0;
    void trackDemandSignal(landingTopicId, "search", userId, weight).catch(() => {});
  }

  return NextResponse.json({
    success: true,
    data: {
      rejected: false,
      landingTopicId,
      topics: topicHits.map((t) => ({
        topicId: t.topicId,
        title: t.title,
        chapterTitle: t.chapterTitle,
        subjectName: t.subjectName,
        grade: t.grade,
        boardCode: t.boardCode,
      })),
    },
  });
}
