"use client";

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";

/**
 * Lively "we're generating your deck" state. Shown while a topic's cards are
 * built on demand (a few seconds on Haiku). An elapsed counter + cycling
 * messages make a short wait read as active progress, never a frozen screen.
 */
const MESSAGES = [
  "Reading the topic…",
  "Designing diagrams…",
  "Writing clear, simple examples…",
  "Adding an Indian-life analogy…",
  "Checking the visuals…",
  "Almost ready…",
];

export function GeneratingCards() {
  const [seconds, setSeconds] = useState(0);
  const [msgIdx, setMsgIdx] = useState(0);

  useEffect(() => {
    const tick = setInterval(() => setSeconds((s) => s + 1), 1000);
    const cycle = setInterval(
      () => setMsgIdx((i) => Math.min(i + 1, MESSAGES.length - 1)),
      2500
    );
    return () => {
      clearInterval(tick);
      clearInterval(cycle);
    };
  }, []);

  return (
    <div className="rounded-2xl border border-dashed border-purple-300 bg-purple-50/40 p-8 text-center dark:border-purple-800 dark:bg-purple-950/30">
      <Sparkles className="mx-auto mb-3 h-7 w-7 animate-pulse text-purple-600 dark:text-purple-300" />
      <p className="text-sm font-medium text-purple-800 dark:text-purple-200">
        Creating your visual cards…
      </p>
      <p className="mt-1 h-4 text-xs text-purple-600/90 transition-all dark:text-purple-300/80">
        {MESSAGES[msgIdx]}
      </p>
      <p className="mt-3 text-[11px] tabular-nums text-purple-500/70 dark:text-purple-300/50">
        {seconds}s · first time on a topic takes a few seconds, then it&apos;s instant
      </p>
    </div>
  );
}
