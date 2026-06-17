"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, CheckCircle2, Play, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { HelpHint } from "./HelpHint";

/**
 * Entry-point button for the Adaptive Visual Explainer.
 *
 * It calls the lightweight status endpoint (which never generates) so the
 * label can reflect reality BEFORE the student clicks:
 *   - no deck yet → "Generate Cards" (+ help explaining first open builds them)
 *   - deck exists, untouched → "Visual Cards"
 *   - in progress → "Resume Cards"
 *   - completed → "Review Cards"
 *
 * On click it navigates programmatically and immediately switches to a
 * disabled spinner ("Generating…" / "Opening…") so the student gets instant
 * feedback and can't fire the (possibly slow) first-time generation twice.
 * The destination route's loading.tsx then carries the feedback through.
 */

interface StatusProgress {
  completed: boolean;
  cardsCompleted: number;
  currentCard: number;
  currentLevel: number;
}

type ButtonState =
  | { kind: "loading" }
  | { kind: "generate" }
  | { kind: "available" }
  | { kind: "resume" }
  | { kind: "review" };

export function VisualCardsButton({
  topicId,
  variant = "solid",
  className,
  showHelp = false,
}: {
  topicId: number;
  variant?: "solid" | "ghost";
  className?: string;
  /** Render a "?" help popover next to the button. */
  showHelp?: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState<ButtonState>({ kind: "loading" });
  const [navigating, setNavigating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    fetch(`/api/topics/${topicId}/explainer/status`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (cancelled) return;
        if (!json?.success) {
          setState({ kind: "available" });
          return;
        }
        const hasDeck: boolean = json.data.hasDeck;
        const progress: StatusProgress | null = json.data.progress;
        if (progress?.completed) setState({ kind: "review" });
        else if (progress && progress.cardsCompleted > 0) setState({ kind: "resume" });
        else if (hasDeck) setState({ kind: "available" });
        else setState({ kind: "generate" });
      })
      .catch(() => {
        if (!cancelled) setState({ kind: "available" });
      });
    return () => {
      cancelled = true;
    };
  }, [topicId]);

  const display = navigating
    ? {
        icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />,
        label: state.kind === "generate" ? "Generating…" : "Opening…",
        title: "Working on it…",
      }
    : renderState(state);

  const base =
    variant === "ghost"
      ? "h-7 text-xs text-violet-700 hover:text-violet-800 hover:bg-violet-50 dark:text-violet-300 dark:hover:bg-violet-950"
      : "h-8 gap-1.5 bg-violet-600 text-white hover:bg-violet-700";

  function handleClick() {
    if (navigating) return;
    setNavigating(true);
    router.push(`/topics/${topicId}/learn`);
  }

  return (
    <span className="inline-flex items-center gap-1">
      <Button
        size="sm"
        variant={variant === "ghost" ? "ghost" : "default"}
        className={cn(base, className)}
        title={display.title}
        disabled={navigating}
        onClick={handleClick}
      >
        {display.icon}
        {display.label}
      </Button>
      {showHelp && (
        <HelpHint
          title="Visual Cards"
          summary="Learn this topic as a short, adaptive card deck"
        >
          <p>
            Visual Cards turn this topic into a short deck of explanation cards —
            each one concept with a diagram, formula, or real-life example.
          </p>
          <p>
            On each card: tap <strong>Got it</strong> to move on,{" "}
            <strong>Explain differently</strong> for a fresh take, or{" "}
            <strong>Ask AI</strong> to ask your own question. It adapts — if a
            topic is tough it drops to a simpler level automatically.
          </p>
          <p className="text-muted-foreground/80">
            First time on a topic, the cards are generated for you (a few
            seconds). After that they open instantly, and your progress is saved
            in the Study Journal.
          </p>
        </HelpHint>
      )}
    </span>
  );
}

function renderState(state: ButtonState): {
  icon: React.ReactNode;
  label: string;
  title: string;
} {
  switch (state.kind) {
    case "loading":
      return {
        icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />,
        label: "Visual Cards",
        title: "Checking for cards…",
      };
    case "generate":
      return {
        icon: <Sparkles className="h-3.5 w-3.5" />,
        label: "Generate Cards",
        title: "No cards yet — the first open will create them (takes a few seconds).",
      };
    case "available":
      return {
        icon: <Sparkles className="h-3.5 w-3.5" />,
        label: "Visual Cards",
        title: "Learn this topic with visual cards.",
      };
    case "resume":
      return {
        icon: <Play className="h-3.5 w-3.5" />,
        label: "Resume Cards",
        title: "Continue where you left off.",
      };
    case "review":
      return {
        icon: <CheckCircle2 className="h-3.5 w-3.5" />,
        label: "Review Cards",
        title: "You completed these — open to review.",
      };
  }
}
