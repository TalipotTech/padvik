/**
 * POST /api/topics/[topicId]/explainer/progress
 *
 * Handles the three student actions:
 *   - got_it          → advance to next card, mark completion when done
 *   - explain_more    → generate a fresh re-explanation card (or drop level)
 *   - ask_question    → generate a targeted Q&A card
 *
 * Also updates the global student_progress mastery score when a deck
 * is completed.
 */
import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import {
  topicExplainerDecks,
  studentExplainerProgress,
} from "@/db/schema/explainers";
import { studentProgress } from "@/db/schema/analytics";
import { generateReExplanation } from "@/lib/explainer/generate-realtime";
import type { Approach, ExplainerCard } from "@/lib/explainer/types";

const BodySchema = z.object({
  action: z.enum(["got_it", "explain_more", "ask_question"]),
  currentCard: z.number().int().positive(),
  timeSpentSecs: z.number().int().nonnegative().optional(),
  question: z.string().min(1).max(1000).optional(),
  language: z.string().max(10).optional(),
});

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

function masteryFromProgress(p: {
  completed: boolean;
  currentLevel: number;
  levelDropped: boolean;
  reExplanations: number;
}): string {
  if (!p.completed) return "0.40";
  if (p.currentLevel === 3) return "1.00"; // advanced completion capped at 1.00 (decimal 3,2)
  if (p.levelDropped) return "0.60";
  if (p.reExplanations >= 3) return "0.75";
  if (p.reExplanations >= 1) return "0.85";
  return "1.00";
}

export async function POST(
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

  const body = await request.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "BAD_BODY", message: parsed.error.issues[0]?.message ?? "invalid" },
      },
      { status: 400 }
    );
  }
  const { action, currentCard, timeSpentSecs, question, language = "en" } = parsed.data;

  // Load the progress row + deck
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

  if (!progress) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "NO_SESSION",
          message: "Start the explainer before posting progress.",
        },
      },
      { status: 400 }
    );
  }

  const [deck] = await db
    .select()
    .from(topicExplainerDecks)
    .where(eq(topicExplainerDecks.id, progress.deckId!))
    .limit(1);

  if (!deck) {
    return NextResponse.json(
      { success: false, error: { code: "NO_DECK", message: "Deck missing" } },
      { status: 404 }
    );
  }

  const deckCards = (deck.cardsJson as ExplainerCard[]) ?? [];
  const totalCards = deckCards.length;
  const approachesUsed = Array.isArray(progress.approachesUsed)
    ? (progress.approachesUsed as Approach[])
    : [];
  const extraCards = Array.isArray(progress.extraCards)
    ? (progress.extraCards as ExplainerCard[])
    : [];

  // -------------------------------------------------------------------------
  // Action handlers
  // -------------------------------------------------------------------------

  if (action === "got_it") {
    const nextCardsCompleted = Math.max(progress.cardsCompleted, currentCard);
    const isComplete = nextCardsCompleted >= totalCards;
    const newTime = progress.timeSpentSecs + (timeSpentSecs ?? 0);

    await db
      .update(studentExplainerProgress)
      .set({
        currentCard: Math.min(currentCard + 1, totalCards),
        cardsCompleted: nextCardsCompleted,
        timeSpentSecs: newTime,
        completed: isComplete,
        completedAt: isComplete ? new Date() : progress.completedAt,
        updatedAt: new Date(),
      })
      .where(eq(studentExplainerProgress.id, progress.id));

    if (isComplete) {
      // Sync topic mastery into student_progress (existing analytics table).
      const masteryLevel = masteryFromProgress({
        completed: true,
        currentLevel: progress.currentLevel,
        levelDropped: progress.levelDropped,
        reExplanations: progress.reExplanations,
      });

      await db
        .insert(studentProgress)
        .values({
          userId,
          topicId,
          masteryLevel,
          confidence: masteryLevel,
          lastStudiedAt: new Date(),
          timeSpentMinutes: Math.round(newTime / 60),
        })
        .onConflictDoUpdate({
          target: [studentProgress.userId, studentProgress.topicId],
          set: {
            masteryLevel,
            confidence: masteryLevel,
            lastStudiedAt: new Date(),
            timeSpentMinutes: sql`${studentProgress.timeSpentMinutes} + ${Math.round(newTime / 60)}`,
            updatedAt: new Date(),
          },
        });

      // Bump the deck's avg_completion (running average)
      await db
        .update(topicExplainerDecks)
        .set({
          avgCompletion: sql`LEAST(
            1.00,
            (${topicExplainerDecks.avgCompletion} * GREATEST(${topicExplainerDecks.viewCount} - 1, 0) + 1.0)
              / GREATEST(${topicExplainerDecks.viewCount}, 1)
          )`,
          updatedAt: new Date(),
        })
        .where(eq(topicExplainerDecks.id, deck.id));
    }

    return NextResponse.json({
      success: true,
      data: {
        completed: isComplete,
        nextCard: isComplete ? null : Math.min(currentCard + 1, totalCards),
        totalCards,
        offerAdvanced:
          isComplete && progress.currentLevel === 2 && progress.reExplanations === 0,
      },
    });
  }

  if (action === "explain_more") {
    // If already stuck on this card in Standard, drop to Foundation first.
    const newReExplanations = progress.reExplanations + 1;
    const shouldDropLevel =
      progress.currentLevel === 2 && newReExplanations >= 2 && !progress.levelDropped;

    if (shouldDropLevel) {
      // Look for a pre-generated Foundation deck.
      const [fdeck] = await db
        .select()
        .from(topicExplainerDecks)
        .where(
          and(
            eq(topicExplainerDecks.topicId, topicId),
            eq(topicExplainerDecks.level, 1),
            eq(topicExplainerDecks.language, deck.language)
          )
        )
        .limit(1);

      if (fdeck) {
        await db
          .update(studentExplainerProgress)
          .set({
            deckId: Number(fdeck.id),
            currentLevel: 1,
            currentCard: Math.min(currentCard, (fdeck.cardCount ?? 1)),
            levelDropped: true,
            reExplanations: newReExplanations,
            updatedAt: new Date(),
          })
          .where(eq(studentExplainerProgress.id, progress.id));

        return NextResponse.json({
          success: true,
          data: {
            type: "level_dropped",
            level: 1,
            deck: {
              id: Number(fdeck.id),
              level: 1,
              cards: fdeck.cardsJson as ExplainerCard[],
              cardCount: fdeck.cardCount,
            },
          },
        });
      }
      // If no Foundation deck, fall through to real-time re-explanation.
    }

    // Real-time re-explanation
    const currentCardApproach =
      (deckCards[currentCard - 1]?.approach as Approach | undefined) ?? "diagram";
    const seen: Approach[] = [
      currentCardApproach,
      ...approachesUsed,
    ];

    let reResult;
    try {
      reResult = await generateReExplanation({
        topicId,
        level: progress.currentLevel as 1 | 2 | 3,
        previousApproaches: seen,
        language,
      });
    } catch (err) {
      console.error("[explainer] re-explanation failed", err);
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "AI_FAILED",
            message: "Could not generate a fresh explanation. Please try again.",
          },
        },
        { status: 502 }
      );
    }

    const newExtraCards = [
      ...extraCards,
      { ...reResult.card, position: extraCards.length + 1, variant: "re" },
    ];

    await db
      .update(studentExplainerProgress)
      .set({
        reExplanations: newReExplanations,
        approachesUsed: [...approachesUsed, reResult.card.approach],
        extraCards: newExtraCards,
        updatedAt: new Date(),
      })
      .where(eq(studentExplainerProgress.id, progress.id));

    return NextResponse.json({
      success: true,
      data: {
        type: "re_explanation",
        card: reResult.card,
      },
    });
  }

  if (action === "ask_question") {
    if (!question) {
      return NextResponse.json(
        { success: false, error: { code: "NO_QUESTION", message: "question required" } },
        { status: 400 }
      );
    }

    const currentCardApproach =
      (deckCards[currentCard - 1]?.approach as Approach | undefined) ?? "diagram";

    let answer;
    try {
      answer = await generateReExplanation({
        topicId,
        level: progress.currentLevel as 1 | 2 | 3,
        previousApproaches: [currentCardApproach, ...approachesUsed],
        studentQuestion: question,
        language,
      });
    } catch (err) {
      console.error("[explainer] Q&A failed", err);
      return NextResponse.json(
        {
          success: false,
          error: { code: "AI_FAILED", message: "Could not answer that question." },
        },
        { status: 502 }
      );
    }

    const newExtraCards = [
      ...extraCards,
      { ...answer.card, position: extraCards.length + 1, variant: "qa" },
    ];

    await db
      .update(studentExplainerProgress)
      .set({
        questionsAsked: progress.questionsAsked + 1,
        extraCards: newExtraCards,
        updatedAt: new Date(),
      })
      .where(eq(studentExplainerProgress.id, progress.id));

    return NextResponse.json({
      success: true,
      data: {
        type: "answer",
        card: answer.card,
      },
    });
  }

  return NextResponse.json(
    { success: false, error: { code: "UNKNOWN_ACTION", message: "unreachable" } },
    { status: 400 }
  );
}
