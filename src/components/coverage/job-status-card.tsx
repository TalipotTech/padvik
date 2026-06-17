/**
 * JobStatusCard — live view of a background bootstrap / fill-gaps scrape job.
 *
 * Originally lived inside /admin/coverage's coverage-explorer.tsx; extracted
 * here so the dashboard's /dashboard/syllabus page can show the exact same
 * progress UI for admins without duplicating the component. Both pages own
 * their own polling loop + `activeJob` state (the polling is coupled to the
 * parent's data-refresh hooks, so it didn't factor out cleanly), but the
 * presentation + outcome copy is identical and lives here.
 *
 * The tricky case this card makes explicit is a completed job with 0 items —
 * that's not a bug, it means NCERT has no book for the selected subject.
 * The final-outcome line calls this out so admins don't bootstrap the same
 * subject over and over expecting a different result.
 */
"use client";

import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

// Shape returned by /api/admin/scrape-jobs/{id}. Captures just what the
// inline job-status card needs — the full row has more fields we don't show.
export interface ActiveJob {
  id: number;
  queueJobId?: string;
  jobType: string;
  status: "queued" | "running" | "paused" | "completed" | "failed" | "cancelled";
  itemsFound: number;
  itemsProcessed: number;
  errorLog: string | null;
  startedAt: string | null;
  completedAt: string | null;
  /** Snapshot taken at queue time so we can render "Bootstrap NCERT — Grade 10 Math" even if metadata is later rewritten. */
  displayLabel: string;
}

const JOB_STATUS_STYLE: Record<ActiveJob["status"], string> = {
  queued: "bg-slate-500/10 text-slate-700 border-slate-500/20",
  running: "bg-sky-500/10 text-sky-700 border-sky-500/20",
  paused: "bg-amber-500/10 text-amber-700 border-amber-500/20",
  completed: "bg-emerald-500/10 text-emerald-700 border-emerald-500/20",
  failed: "bg-rose-500/10 text-rose-700 border-rose-500/20",
  cancelled: "bg-zinc-500/10 text-zinc-700 border-zinc-500/20",
};

const JOB_STATUS_LABEL: Record<ActiveJob["status"], string> = {
  queued: "Queued",
  running: "Running",
  paused: "Paused",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

function formatDuration(startIso: string | null, endIso: string | null): string | null {
  if (!startIso) return null;
  const start = new Date(startIso).getTime();
  const end = endIso ? new Date(endIso).getTime() : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const ms = Math.max(0, end - start);
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return `${min}m ${rem}s`;
}

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString();
}

export function JobStatusCard({
  job,
  onDismiss,
}: {
  job: ActiveJob;
  onDismiss: () => void;
}) {
  const isTerminal =
    job.status === "completed" || job.status === "failed" || job.status === "cancelled";
  const pct =
    job.itemsFound > 0
      ? Math.min(100, Math.round((job.itemsProcessed / job.itemsFound) * 100))
      : job.status === "completed"
      ? 100
      : 0;

  // Bar fill colour tracks job state — green on success, rose on failure,
  // violet while running. Keeps the animation cheap (CSS width transition).
  const barColour =
    job.status === "failed" || job.status === "cancelled"
      ? "bg-rose-500"
      : job.status === "completed"
      ? "bg-emerald-500"
      : "bg-violet-500";

  // Humanised outcome line. We special-case the most common "silent failure"
  // — a completed job with 0 items — because that's the exact confusion the
  // user flagged (clicked bootstrap, worker logged "0 books", UI showed
  // nothing). Message differs per job type: bootstrap deals in chapters,
  // fill-gaps deals in topics.
  const isFill = job.jobType === "cbse_content_fill";
  const unit = isFill ? "topic" : "chapter";
  let outcome: { tone: "ok" | "warn" | "err"; text: string } | null = null;
  if (job.status === "completed") {
    if (job.itemsProcessed === 0) {
      outcome = {
        tone: "warn",
        text: isFill
          ? "Completed with 0 topics written. Either every topic already had content or the worker couldn't extract any — check /scrape-jobs for the error log."
          : "Completed with 0 chapters. The NCERT catalog had no matching book for this subject — this is expected for CBSE skill subjects (Computer Applications, Painting, etc.). Use the CBSE Syllabus scraper or AI Content Generator instead.",
      };
    } else {
      outcome = {
        tone: "ok",
        text: isFill
          ? `Completed: ${job.itemsProcessed} topic(s) filled${
              job.itemsFound > job.itemsProcessed ? ` of ${job.itemsFound} attempted` : ""
            }. Rows are saved as review_status='pending' — run Auto-publish (step 3) to flip high-quality ones to visible.`
          : `Completed: ${job.itemsProcessed} ${unit}(s) parsed${
              job.itemsFound > job.itemsProcessed ? ` of ${job.itemsFound} attempted` : ""
            }. Run Fan-out (step 2) next to propagate to topics.`,
      };
    }
  } else if (job.status === "failed") {
    outcome = {
      tone: "err",
      text: job.errorLog
        ? `Failed: ${job.errorLog.slice(0, 280)}${job.errorLog.length > 280 ? "…" : ""}`
        : "Failed — check /scrape-jobs for details.",
    };
  } else if (job.status === "cancelled") {
    outcome = { tone: "warn", text: "Cancelled." };
  }

  return (
    <div className="rounded-md border bg-card p-3 text-sm shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge className={`border ${JOB_STATUS_STYLE[job.status]}`} variant="outline">
          {!isTerminal && <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />}
          {JOB_STATUS_LABEL[job.status]}
        </Badge>
        <span className="font-mono text-xs text-muted-foreground">Job #{job.id}</span>
        <span className="truncate font-medium">{job.displayLabel}</span>
        <div className="ml-auto flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link href={`/scrape-jobs`} target="_blank">
              <ExternalLink className="mr-1 h-3 w-3" />
              Jobs
            </Link>
          </Button>
          {isTerminal && (
            <button
              className="text-xs text-muted-foreground underline hover:text-foreground"
              onClick={onDismiss}
            >
              dismiss
            </button>
          )}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>
          Started <span className="font-mono">{formatTime(job.startedAt)}</span>
        </span>
        {isTerminal && (
          <span>
            Ended <span className="font-mono">{formatTime(job.completedAt)}</span>
          </span>
        )}
        {formatDuration(job.startedAt, job.completedAt) && (
          <span>
            Duration{" "}
            <span className="font-mono">
              {formatDuration(job.startedAt, job.completedAt)}
            </span>
          </span>
        )}
        <span>
          Progress{" "}
          <span className="font-mono">
            {job.itemsProcessed}
            {job.itemsFound > 0 ? ` / ${job.itemsFound}` : ""}
          </span>
        </span>
      </div>

      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full ${barColour} transition-all duration-500`}
          style={{ width: `${pct}%` }}
        />
      </div>

      {outcome && (
        <div
          className={`mt-2 flex items-start gap-2 rounded-md border p-2 text-xs ${
            outcome.tone === "ok"
              ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-800"
              : outcome.tone === "warn"
              ? "border-amber-500/20 bg-amber-500/5 text-amber-800"
              : "border-rose-500/20 bg-rose-500/5 text-rose-800"
          }`}
        >
          {outcome.tone === "ok" ? (
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          ) : (
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          )}
          <span>{outcome.text}</span>
        </div>
      )}

      {!isTerminal && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Polling every 3s — leave this page open or return later; the job runs server-side.
        </p>
      )}
    </div>
  );
}
