/**
 * Shown the instant a student navigates to the Visual Explainer, while the
 * server component awaits the deck. For a topic without a pre-generated deck
 * the GET route builds one on the fly (a few seconds) — this keeps the click
 * responsive and tells the student a card is being created instead of a frozen
 * screen.
 */
import { Sparkles } from "lucide-react";

export default function Loading() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 via-purple-50/20 to-white px-4 py-6 dark:from-slate-950 dark:via-purple-950/10 dark:to-slate-900 sm:py-10">
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        {/* Header skeleton */}
        <div className="flex items-center justify-between">
          <div className="h-5 w-40 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
          <div className="h-5 w-20 animate-pulse rounded-full bg-purple-100 dark:bg-purple-950" />
        </div>

        {/* Progress bar skeleton */}
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
          <div className="h-full w-1/4 animate-pulse rounded-full bg-gradient-to-r from-purple-400 to-violet-500" />
        </div>

        {/* Generating card */}
        <div className="rounded-2xl border border-dashed border-purple-300 bg-purple-50/40 p-8 text-center dark:border-purple-800 dark:bg-purple-950/30">
          <Sparkles className="mx-auto mb-3 h-7 w-7 animate-pulse text-purple-600 dark:text-purple-300" />
          <p className="text-sm font-medium text-purple-800 dark:text-purple-200">
            Creating your visual cards…
          </p>
          <p className="mt-1 text-xs text-purple-600/80 dark:text-purple-300/70">
            First time on this topic can take a few seconds while we build the
            explanations. After that it&apos;s instant.
          </p>
        </div>
      </div>
    </main>
  );
}
