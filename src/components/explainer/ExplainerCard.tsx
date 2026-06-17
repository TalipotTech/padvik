"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { ExplainerCard as ExplainerCardType } from "@/lib/explainer/types";
import { BlockView } from "./blocks";

/**
 * Renders a single explanation card. Blocks fade in one at a time so it
 * feels like a tutor writing on a board rather than a slide reveal.
 */
export function ExplainerCard({
  card,
  className,
}: {
  card: ExplainerCardType;
  className?: string;
}) {
  const [visibleCount, setVisibleCount] = useState(1);

  useEffect(() => {
    setVisibleCount(1);
    const totalBlocks = card.blocks.length;
    if (totalBlocks <= 1) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let i = 1; i < totalBlocks; i++) {
      timers.push(
        setTimeout(() => {
          setVisibleCount((n) => Math.min(totalBlocks, Math.max(n, i + 1)));
        }, 220 * i)
      );
    }
    return () => timers.forEach(clearTimeout);
  }, [card]);

  return (
    <article
      className={cn(
        "relative rounded-2xl border border-purple-200 bg-white p-5 shadow-sm transition-all dark:border-purple-900 dark:bg-slate-900",
        className
      )}
    >
      <header className="mb-3 border-b border-purple-100 pb-3 dark:border-purple-900">
        <h2 className="text-xl font-semibold text-foreground">{card.title}</h2>
        {card.subtitle && (
          <p className="mt-0.5 text-sm text-muted-foreground">{card.subtitle}</p>
        )}
      </header>

      <div className="space-y-3">
        {card.blocks.slice(0, visibleCount).map((block, i) => (
          <div
            key={i}
            className="animate-in fade-in slide-in-from-bottom-1 duration-300"
          >
            <BlockView block={block} />
          </div>
        ))}
      </div>

      <footer className="mt-4 flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
        <span className="rounded-full bg-purple-100 px-2 py-0.5 font-medium text-purple-700 dark:bg-purple-950 dark:text-purple-300">
          {card.approach.replace("_", " ")}
        </span>
        <span>· ~{card.estimatedReadTime}s</span>
        {card.isPreGenerated === false && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
            Just for you
          </span>
        )}
      </footer>
    </article>
  );
}
