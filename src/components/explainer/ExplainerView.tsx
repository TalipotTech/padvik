"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Sparkles } from "lucide-react";
import Link from "next/link";
import type { ExplainerCard as ExplainerCardType } from "@/lib/explainer/types";
import { ExplainerCard } from "./ExplainerCard";
import { ExplainerActions, type ExplainerActionKind } from "./ExplainerActions";
import { ExplainerComplete } from "./ExplainerComplete";

interface InitialData {
  topic: {
    id: number;
    title: string;
    chapterTitle?: string | null;
    chapterNumber?: number | null;
    subjectName?: string | null;
    subjectId?: number | null;
    grade?: number | null;
    academicYear?: string | null;
    boardCode?: string | null;
    boardName?: string | null;
  };
  deck: {
    id: number;
    level: number;
    language: string;
    cards: ExplainerCardType[];
    cardCount?: number | null;
    totalReadTime?: number | null;
  };
  extraCards: ExplainerCardType[];
  progress: {
    currentCard: number;
    currentLevel: number;
    cardsCompleted: number;
    reExplanations: number;
    questionsAsked: number;
    completed: boolean;
    levelDropped: boolean;
    levelRaised: boolean;
    timeSpentSecs: number;
  } | null;
  hasLevel1: boolean;
  hasLevel2: boolean;
  hasLevel3: boolean;
}

const LEVEL_LABEL: Record<number, string> = {
  1: "Foundation",
  2: "Standard",
  3: "Advanced",
};

export function ExplainerView({
  topicId,
  initial,
  backHref,
}: {
  topicId: number;
  initial: InitialData;
  backHref?: string;
}) {
  const [deck, setDeck] = useState(initial.deck);
  const [progress, setProgress] = useState(initial.progress);
  const [overlayCard, setOverlayCard] = useState<ExplainerCardType | null>(null);
  const [loadingAction, setLoadingAction] = useState<ExplainerActionKind | null>(null);
  const [currentCardIdx, setCurrentCardIdx] = useState(
    Math.max(0, (initial.progress?.currentCard ?? 1) - 1)
  );
  const [isComplete, setIsComplete] = useState(initial.progress?.completed ?? false);
  const [showAdvancedOffer, setShowAdvancedOffer] = useState(false);

  const startedAtRef = useRef(Date.now());

  const cards = deck.cards;
  const card = overlayCard ?? cards[currentCardIdx];
  const totalCards = cards.length;

  // Secs since this card rendered — used to estimate time spent.
  const secsOnCard = useCallback(() => {
    return Math.round((Date.now() - startedAtRef.current) / 1000);
  }, []);

  useEffect(() => {
    startedAtRef.current = Date.now();
  }, [currentCardIdx, overlayCard]);

  const postProgress = useCallback(
    async (
      action: ExplainerActionKind,
      extras: { question?: string } = {}
    ) => {
      setLoadingAction(action);
      try {
        const res = await fetch(`/api/topics/${topicId}/explainer/progress`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            currentCard: currentCardIdx + 1,
            timeSpentSecs: secsOnCard(),
            ...extras,
          }),
        });
        const json = await res.json();
        if (!json.success) {
          toast.error(json.error?.message ?? "Something went wrong");
          return null;
        }
        return json.data;
      } catch (err) {
        console.error(err);
        toast.error("Network error — try again");
        return null;
      } finally {
        setLoadingAction(null);
      }
    },
    [topicId, currentCardIdx, secsOnCard]
  );

  const handleGotIt = useCallback(async () => {
    // If viewing an overlay (re-explanation/Q&A), closing it returns to deck
    if (overlayCard) {
      setOverlayCard(null);
      return;
    }
    const data = await postProgress("got_it");
    if (!data) return;
    if (data.completed) {
      setIsComplete(true);
      setShowAdvancedOffer(Boolean(data.offerAdvanced));
      setProgress((p) => (p ? { ...p, completed: true, cardsCompleted: totalCards } : p));
    } else {
      const next = data.nextCard ? data.nextCard - 1 : currentCardIdx + 1;
      setCurrentCardIdx(Math.min(totalCards - 1, next));
      setProgress((p) =>
        p ? { ...p, currentCard: data.nextCard ?? p.currentCard, cardsCompleted: Math.max(p.cardsCompleted, currentCardIdx + 1) } : p
      );
    }
  }, [overlayCard, postProgress, totalCards, currentCardIdx]);

  const handleExplainMore = useCallback(async () => {
    const data = await postProgress("explain_more");
    if (!data) return;
    if (data.type === "level_dropped") {
      toast.message("Let's try a simpler take", {
        description: "Dropping to Foundation level for this topic.",
      });
      setDeck({
        ...deck,
        id: data.deck.id,
        level: data.deck.level,
        cards: data.deck.cards,
      });
      setCurrentCardIdx(0);
      setOverlayCard(null);
      setProgress((p) =>
        p ? { ...p, currentLevel: 1, levelDropped: true, reExplanations: p.reExplanations + 1 } : p
      );
    } else if (data.type === "re_explanation") {
      setOverlayCard(data.card);
      setProgress((p) =>
        p ? { ...p, reExplanations: p.reExplanations + 1 } : p
      );
    }
  }, [postProgress, deck]);

  const handleAsk = useCallback(
    async (question: string) => {
      const data = await postProgress("ask_question", { question });
      if (!data) return;
      if (data.type === "answer") {
        setOverlayCard(data.card);
        setProgress((p) =>
          p ? { ...p, questionsAsked: p.questionsAsked + 1 } : p
        );
      }
    },
    [postProgress]
  );

  const handleTryAdvanced = useCallback(async () => {
    const res = await fetch(`/api/topics/${topicId}/explainer?level=3`);
    const json = await res.json();
    if (!json.success) {
      toast.error("Advanced deck not ready yet");
      return;
    }
    setDeck(json.data.deck);
    setProgress(json.data.progress);
    setCurrentCardIdx(0);
    setIsComplete(false);
    setShowAdvancedOffer(false);
    setOverlayCard(null);
  }, [topicId]);

  const progressPct = useMemo(() => {
    if (isComplete) return 100;
    return Math.round(((currentCardIdx) / Math.max(1, totalCards)) * 100);
  }, [currentCardIdx, totalCards, isComplete]);

  if (isComplete && !overlayCard) {
    return (
      <ExplainerComplete
        topicTitle={initial.topic.title}
        cardsCompleted={progress?.cardsCompleted ?? totalCards}
        timeSpentSecs={progress?.timeSpentSecs ?? 0}
        reExplanations={progress?.reExplanations ?? 0}
        offerAdvanced={showAdvancedOffer && initial.hasLevel3}
        onTryAdvanced={handleTryAdvanced}
        backHref={backHref}
      />
    );
  }

  if (!card) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
        No explainer cards available for this topic yet.
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-3">
      <header className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          {backHref && (
            <Link
              href={backHref}
              className="mt-0.5 rounded-md p-1.5 text-muted-foreground hover:bg-purple-50 hover:text-purple-700 dark:hover:bg-purple-950"
              aria-label="Back"
            >
              <ArrowLeft size={18} />
            </Link>
          )}
          <div className="min-w-0">
            <h1 className="text-base font-semibold line-clamp-1">{initial.topic.title}</h1>
            <TopicMeta topic={initial.topic} />
          </div>
        </div>
        <span className="flex shrink-0 items-center gap-1 rounded-full border border-purple-200 bg-purple-50 px-2 py-0.5 text-xs font-medium text-purple-700 dark:border-purple-800 dark:bg-purple-950 dark:text-purple-300">
          <Sparkles size={12} /> {LEVEL_LABEL[deck.level] ?? "Standard"}
        </span>
      </header>

      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {overlayCard
              ? "A fresh take"
              : `Card ${Math.min(currentCardIdx + 1, totalCards)} of ${totalCards}`}
          </span>
          <span>{progressPct}%</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
          <div
            className="h-full rounded-full bg-gradient-to-r from-purple-500 to-violet-600 transition-all"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {loadingAction && loadingAction !== "got_it" ? (
        <div className="rounded-2xl border border-dashed border-purple-300 bg-purple-50/40 p-6 text-center text-sm text-purple-700 dark:border-purple-800 dark:bg-purple-950/30 dark:text-purple-300">
          <Sparkles className="mx-auto mb-2 animate-pulse" size={20} />
          Creating a new explanation for you...
        </div>
      ) : (
        <ExplainerCard card={card} />
      )}

      <ExplainerActions
        onGotIt={handleGotIt}
        onExplainMore={handleExplainMore}
        onAsk={handleAsk}
        isLoading={loadingAction}
      />

      {overlayCard && (
        <p className="text-center text-xs text-muted-foreground">
          Viewing a fresh explanation. Tap “Got it” to return to the deck.
        </p>
      )}
    </div>
  );
}

function TopicMeta({ topic }: { topic: InitialData["topic"] }) {
  const parts: string[] = [];
  if (topic.subjectName) parts.push(topic.subjectName);
  if (topic.chapterNumber != null)
    parts.push(`Ch ${topic.chapterNumber}${topic.chapterTitle ? `: ${topic.chapterTitle}` : ""}`);
  else if (topic.chapterTitle) parts.push(topic.chapterTitle);

  const classParts: string[] = [];
  if (topic.boardCode) classParts.push(topic.boardCode);
  if (topic.grade != null) classParts.push(`Class ${topic.grade}`);
  if (topic.academicYear) classParts.push(topic.academicYear);
  if (classParts.length) parts.push(classParts.join(" · "));

  if (parts.length === 0) return null;
  return (
    <p className="mt-0.5 truncate text-xs text-muted-foreground">{parts.join(" · ")}</p>
  );
}
