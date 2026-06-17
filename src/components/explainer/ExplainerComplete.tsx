"use client";

import { Trophy, Sparkles, ArrowRight } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export function ExplainerComplete({
  topicTitle,
  cardsCompleted,
  timeSpentSecs,
  reExplanations,
  offerAdvanced,
  onTryAdvanced,
  backHref,
}: {
  topicTitle: string;
  cardsCompleted: number;
  timeSpentSecs: number;
  reExplanations: number;
  offerAdvanced?: boolean;
  onTryAdvanced?: () => void;
  backHref?: string;
}) {
  const minutes = Math.max(1, Math.round(timeSpentSecs / 60));
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-4 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-6 text-center dark:border-emerald-900 dark:bg-emerald-950/40">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500 text-white">
        <Trophy size={28} />
      </div>
      <div>
        <h2 className="text-xl font-semibold">Nice work!</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          You finished <span className="font-medium">{topicTitle}</span>.
        </p>
      </div>
      <div className="grid grid-cols-3 gap-2 text-xs">
        <Stat label="Cards" value={cardsCompleted} />
        <Stat label="Minutes" value={minutes} />
        <Stat label="Re-explains" value={reExplanations} />
      </div>

      <div className="flex flex-col gap-2 pt-2 sm:flex-row">
        {offerAdvanced && onTryAdvanced && (
          <Button onClick={onTryAdvanced} className="bg-purple-600 text-white hover:bg-purple-700">
            <Sparkles size={16} /> Try advanced level
          </Button>
        )}
        {backHref && (
          <Button asChild variant="outline">
            <Link href={backHref}>
              Back to topic <ArrowRight size={16} />
            </Link>
          </Button>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-white px-3 py-2 text-center shadow-sm dark:bg-slate-900">
      <div className="text-lg font-semibold text-emerald-700 dark:text-emerald-300">
        {value}
      </div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
    </div>
  );
}
