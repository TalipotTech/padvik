/**
 * GET /api/topics/[topicId]/explainer
 *
 * Returns the explainer deck for a topic, creating/resuming the student's
 * progress row. If no deck exists at the requested level, Level 2 is
 * generated on the fly as a fallback.
 */
import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { topicExplainerDecks, studentExplainerProgress } from "@/db/schema/explainers";
import { topics, chapters, subjects, standards, boards } from "@/db/schema/curriculum";
import { generateTopicDeck } from "@/lib/explainer/generate-deck";
import { AI_MODELS } from "@/lib/ai/provider";
import type { ExplainerCard } from "@/lib/explainer/types";

async function getUserId(): Promise<number | null> {
  try {
    const session = await auth();
    const raw = session?.user?.id;
    if (!raw) return null;
    // Demo sessions have IDs like "demo-student" — treat as unauth for DB writes.
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

  let userId = await getUserId();
  if (!userId && process.env.NODE_ENV === "development") userId = 1;
  if (!userId) {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Login required" } },
      { status: 401 }
    );
  }

  const language = request.nextUrl.searchParams.get("language") ?? "en";
  const requestedLevel = request.nextUrl.searchParams.get("level");

  // Resume prior progress if any
  const [prior] = await db
    .select()
    .from(studentExplainerProgress)
    .where(
      and(
        eq(studentExplainerProgress.studentId, userId),
        eq(studentExplainerProgress.topicId, topicId)
      )
    )
    .limit(1);

  const level: 1 | 2 | 3 = (() => {
    if (requestedLevel === "1" || requestedLevel === "2" || requestedLevel === "3") {
      return Number(requestedLevel) as 1 | 2 | 3;
    }
    if (prior) return (prior.currentLevel as 1 | 2 | 3) ?? 2;
    return 2;
  })();

  // Confirm the topic exists so we can return a clean 404. Pull the
  // curriculum context (subject / chapter / board / class) so the explainer
  // header can show where the student is, like the Playground does.
  const [topicRow] = await db
    .select({
      id: topics.id,
      title: topics.title,
      chapterTitle: chapters.title,
      chapterNumber: chapters.chapterNumber,
      subjectName: subjects.name,
      subjectId: subjects.id,
      grade: standards.grade,
      academicYear: standards.academicYear,
      boardCode: boards.code,
      boardName: boards.name,
    })
    .from(topics)
    .leftJoin(chapters, eq(chapters.id, topics.chapterId))
    .leftJoin(subjects, eq(subjects.id, chapters.subjectId))
    .leftJoin(standards, eq(standards.id, subjects.standardId))
    .leftJoin(boards, eq(boards.id, standards.boardId))
    .where(eq(topics.id, topicId))
    .limit(1);

  if (!topicRow) {
    return NextResponse.json(
      { success: false, error: { code: "NOT_FOUND", message: "Topic not found" } },
      { status: 404 }
    );
  }

  // Look up the deck at the chosen level
  let [deck] = await db
    .select()
    .from(topicExplainerDecks)
    .where(
      and(
        eq(topicExplainerDecks.topicId, topicId),
        eq(topicExplainerDecks.level, level),
        eq(topicExplainerDecks.language, language)
      )
    )
    .limit(1);

  // Fallback — generate Level 2 on demand if we have nothing at all for this
  // topic. This keeps the UX working even before the admin bulk-fills.
  // Use the faster BULK model (Haiku) here so the student isn't blocked for
  // 30–40s on a Sonnet generation; admin bulk pre-generation uses Sonnet for
  // higher quality and those cached decks take precedence whenever present.
  if (!deck) {
    try {
      await generateTopicDeck(topicId, level === 1 ? 2 : level, language, {
        model: AI_MODELS.BULK,
        maxCards: 4,
      });
      [deck] = await db
        .select()
        .from(topicExplainerDecks)
        .where(
          and(
            eq(topicExplainerDecks.topicId, topicId),
            eq(topicExplainerDecks.level, level === 1 ? 2 : level),
            eq(topicExplainerDecks.language, language)
          )
        )
        .limit(1);
    } catch (err) {
      console.error("[explainer] generate-on-demand failed", err);
    }
  }

  if (!deck) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "DECK_UNAVAILABLE",
          message:
            "Could not prepare an explainer deck for this topic. Please try again shortly.",
        },
      },
      { status: 503 }
    );
  }

  // Availability flags for the UI (show "drop to Foundation" / "try Advanced")
  const levelAvailability = await db
    .select({ level: topicExplainerDecks.level })
    .from(topicExplainerDecks)
    .where(
      and(
        eq(topicExplainerDecks.topicId, topicId),
        eq(topicExplainerDecks.language, language)
      )
    );
  const availableLevels = new Set(levelAvailability.map((r) => r.level));

  // Create progress row if none exists, else update deck pointer if it changed
  if (!prior) {
    await db
      .insert(studentExplainerProgress)
      .values({
        studentId: userId,
        topicId,
        deckId: Number(deck.id),
        currentLevel: level,
        currentCard: 1,
      })
      .onConflictDoNothing();
  } else if (Number(prior.deckId) !== Number(deck.id) || prior.currentLevel !== level) {
    await db
      .update(studentExplainerProgress)
      .set({
        deckId: Number(deck.id),
        currentLevel: level,
        updatedAt: new Date(),
      })
      .where(eq(studentExplainerProgress.id, prior.id));
  }

  // Re-read progress for a consistent response
  const [progress] = await db
    .select()
    .from(studentExplainerProgress)
    .where(
      and(
        eq(studentExplainerProgress.studentId, userId),
        eq(studentExplainerProgress.topicId, topicId)
      )
    )
    .limit(1);

  // Bump view_count (best-effort)
  await db
    .update(topicExplainerDecks)
    .set({ viewCount: sql`${topicExplainerDecks.viewCount} + 1` })
    .where(eq(topicExplainerDecks.id, deck.id));

  const cards = (deck.cardsJson as ExplainerCard[]) ?? [];
  const extraCards = (progress?.extraCards as ExplainerCard[]) ?? [];

  return NextResponse.json({
    success: true,
    data: {
      topic: {
        id: Number(topicRow.id),
        title: topicRow.title,
        chapterTitle: topicRow.chapterTitle ?? null,
        chapterNumber: topicRow.chapterNumber ?? null,
        subjectName: topicRow.subjectName ?? null,
        subjectId: topicRow.subjectId != null ? Number(topicRow.subjectId) : null,
        grade: topicRow.grade ?? null,
        academicYear: topicRow.academicYear ?? null,
        boardCode: topicRow.boardCode ?? null,
        boardName: topicRow.boardName ?? null,
      },
      deck: {
        id: Number(deck.id),
        level: deck.level,
        language: deck.language,
        cards,
        cardCount: deck.cardCount,
        totalReadTime: deck.totalReadTime,
      },
      extraCards,
      progress: progress
        ? {
            currentCard: progress.currentCard,
            currentLevel: progress.currentLevel,
            cardsCompleted: progress.cardsCompleted,
            reExplanations: progress.reExplanations,
            questionsAsked: progress.questionsAsked,
            completed: progress.completed,
            levelDropped: progress.levelDropped,
            levelRaised: progress.levelRaised,
            timeSpentSecs: progress.timeSpentSecs,
          }
        : null,
      hasLevel1: availableLevels.has(1),
      hasLevel2: availableLevels.has(2),
      hasLevel3: availableLevels.has(3),
    },
  });
}
