/**
 * GET /api/topics/[topicId]/explainer/status
 *
 * Lightweight availability check for the Visual Cards button. Unlike the main
 * explainer route, this NEVER generates a deck — it only reports whether one
 * already exists and the caller's progress, so a button can show
 * "Generate" vs "Resume" vs "Review" before the student commits to a click.
 */
import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { topicExplainerDecks, studentExplainerProgress } from "@/db/schema/explainers";

async function getUserId(): Promise<number | null> {
  try {
    const session = await auth();
    const raw = session?.user?.id;
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ topicId: string }> }
) {
  const { topicId: topicIdParam } = await context.params;
  const topicId = Number(topicIdParam);
  if (!Number.isFinite(topicId)) {
    return NextResponse.json(
      { success: false, error: { code: "INVALID_TOPIC", message: "Bad topic id" } },
      { status: 400 }
    );
  }

  const language = request.nextUrl.searchParams.get("language") ?? "en";

  // Which levels have a pre-generated deck (cheap, indexed lookup).
  const deckRows = await db
    .select({ level: topicExplainerDecks.level })
    .from(topicExplainerDecks)
    .where(
      and(
        eq(topicExplainerDecks.topicId, topicId),
        eq(topicExplainerDecks.language, language)
      )
    );
  const levels = deckRows.map((r) => r.level).sort((a, b) => a - b);

  // The student's progress, if any. Demo (non-numeric) sessions just get null.
  let progress: {
    completed: boolean;
    cardsCompleted: number;
    currentCard: number;
    currentLevel: number;
  } | null = null;

  const userId = await getUserId();
  if (userId != null) {
    const [row] = await db
      .select({
        completed: studentExplainerProgress.completed,
        cardsCompleted: studentExplainerProgress.cardsCompleted,
        currentCard: studentExplainerProgress.currentCard,
        currentLevel: studentExplainerProgress.currentLevel,
      })
      .from(studentExplainerProgress)
      .where(
        and(
          eq(studentExplainerProgress.studentId, userId),
          eq(studentExplainerProgress.topicId, topicId)
        )
      )
      .limit(1);
    if (row) progress = row;
  }

  return NextResponse.json({
    success: true,
    data: {
      hasDeck: levels.length > 0,
      levels,
      progress,
    },
  });
}
