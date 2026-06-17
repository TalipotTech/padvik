/**
 * Shown the instant a student navigates to the Visual Explainer, while the
 * server component awaits the deck. For a topic without a pre-generated deck
 * the GET route builds one on the fly (a few seconds) — this keeps the click
 * responsive and tells the student a card is being created instead of a frozen
 * screen.
 */
import { GeneratingCards } from "@/components/explainer/GeneratingCards";

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

        {/* Generating card (lively: elapsed timer + cycling messages) */}
        <GeneratingCards />
      </div>
    </main>
  );
}
