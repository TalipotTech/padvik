"use client";

/**
 * Auto-content pipeline admin dashboard (client).
 *
 * Receives the initial server-fetched payload, renders the stat cards and four
 * sections, and handles all interactivity (generate / approve / reject) by
 * calling the admin API routes and re-fetching the dashboard afterwards.
 */
import { Fragment, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { HelpCircle, X, AlertTriangle } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ---------------------------------------------------------------------------
// Types (mirror GET /api/admin/auto-content)
// ---------------------------------------------------------------------------
type ContentType = "text_note" | "audio_explainer" | "question_set" | "video_lesson";

interface TodayStats {
  generated: number;
  pending: number;
  published: number;
  failed: number;
  costUsd: number;
  budgetRemaining: number;
  budgetLimit: number;
}

interface DemandTopic {
  topicId: number;
  topicName: string | null;
  chapter: string | null;
  subject: string | null;
  board: string | null;
  class: number | null;
  demandScore: number;
  uniqueStudents: number;
  hasExistingContent: boolean;
  signalBreakdown: Record<string, number>;
}

interface RecentJob {
  id: number;
  status: string;
  contentType: string;
  topicId: number;
  topicName: string | null;
  chapter: string | null;
  subject: string | null;
  class: number | null;
  board: string | null;
  requestedModel: string;
  model: string | null;
  provider: string | null;
  costUsd: number | null;
  createdAt: string;
  /** Audio job published/awaiting review with no media file (transcript-only). */
  audioPending?: boolean;
  /** Failure reason (present on failed jobs). */
  lastError?: string | null;
}

interface ModelCost {
  model: string;
  provider: string;
  cost: number;
  count: number;
}

interface BudgetDay {
  date: string;
  cost: number;
  count: number;
}

/** A topic from the syllabus search, flattened for the generate UI. */
interface SearchTopic {
  topicId: number;
  topicName: string;
  board: string | null;
  class: number | null;
  subject: string | null;
  chapter: string | null;
}

/** Raw shape returned by GET /api/syllabus/search. */
interface RawSearchTopic {
  id: number;
  title: string;
  board?: { code?: string } | null;
  standard?: { grade?: number } | null;
  subject?: { name?: string } | null;
  chapter?: { title?: string } | null;
}

export interface DashboardData {
  todayStats: TodayStats;
  totals: { published: number; topicsWithContent: number };
  topDemandTopics: DemandTopic[];
  recentJobs: RecentJob[];
  budgetHistory: BudgetDay[];
  costByModel: ModelCost[];
}

// Block / question shapes for previews (loose — these come from stored JSON)
interface ContentBlockLike {
  type: string;
  content?: string;
  latex?: string;
  variant?: string;
  items?: string[];
}
interface QuestionLike {
  questionText: string;
  questionType: string;
  marks?: number;
}
interface JobDetailContent {
  contentType: string;
  body: string | null;
  mediaUrl: string | null;
  processedUrl: string | null;
  aiTranscript: string | null;
}

const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
  text_note: "Text Note",
  audio_explainer: "Audio",
  question_set: "Question Set",
  video_lesson: "Video",
};

// Model choices for manual generation. "default" keeps the working rotation
// (Claude/Gemini for LLM, ElevenLabs/Sarvam for TTS). The rest let an admin
// generate additional content on the same topic with a different provider.
const MODEL_OPTIONS: { value: string; label: string }[] = [
  { value: "default", label: "Default (auto rotation)" },
  { value: "claude-opus-4-8", label: "Claude Opus 4.8" },
  { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  { value: "gpt-4o", label: "GPT-4o (OpenAI)" },
  { value: "sonar", label: "Perplexity Sonar" },
  { value: "mistral-large-latest", label: "Mistral Large" },
];
const MODEL_LABEL: Record<string, string> = Object.fromEntries(
  MODEL_OPTIONS.map((o) => [o.value, o.label])
);

const STATUS_STYLES: Record<string, string> = {
  queued: "bg-muted text-muted-foreground",
  generating: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  reviewing: "bg-violet-500/15 text-violet-600 dark:text-violet-400",
  published: "bg-green-500/15 text-green-600 dark:text-green-400",
  failed: "bg-red-500/15 text-red-600 dark:text-red-400",
  rejected: "bg-muted text-muted-foreground/60",
};

function fmtDate(iso: string): string {
  // Deterministic (avoids SSR/client locale hydration mismatch)
  try {
    return new Date(iso).toISOString().slice(0, 16).replace("T", " ");
  } catch {
    return iso;
  }
}

function fmtMoney(n: number): string {
  return `$${n.toFixed(2)}`;
}

/** Convert a YouTube watch/share URL into an embeddable URL (or null). */
function youtubeEmbedUrl(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(/(?:v=|youtu\.be\/|\/embed\/|\/shorts\/)([a-zA-Z0-9_-]{11})/);
  return m ? `https://www.youtube.com/embed/${m[1]}` : null;
}

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_STYLES[status] ?? "bg-muted text-muted-foreground";
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function AutoContentDashboard({ initialData }: { initialData: DashboardData }) {
  const [data, setData] = useState<DashboardData>(initialData);
  const [refreshing, setRefreshing] = useState(false);
  const [genType, setGenType] = useState<Record<number, ContentType>>({});
  const [genModel, setGenModel] = useState<Record<number, string>>({});
  const [busyTopics, setBusyTopics] = useState<Set<number>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchTopic[]>([]);
  const [searching, setSearching] = useState(false);
  // topicId -> existing jobs for the searched topics
  const [existingByTopic, setExistingByTopic] = useState<
    Record<number, { contentType: string; status: string; requestedModel: string }[]>
  >({});
  const [busyJobs, setBusyJobs] = useState<Set<number>>(new Set());
  const [details, setDetails] = useState<Record<number, JobDetailContent | null>>({});
  const [audioErrors, setAudioErrors] = useState<Record<number, string | null>>({});
  const [showQuickStart, setShowQuickStart] = useState(true);

  // Respect a previous dismissal of the quick-start banner.
  useEffect(() => {
    try {
      if (localStorage.getItem("padvik:autocontent:quickstart-dismissed") === "1") {
        setShowQuickStart(false);
      }
    } catch {
      /* ignore */
    }
  }, []);

  function dismissQuickStart() {
    setShowQuickStart(false);
    try {
      localStorage.setItem("padvik:autocontent:quickstart-dismissed", "1");
    } catch {
      /* ignore */
    }
  }

  const reviewingJobs = data.recentJobs.filter((j) => j.status === "reviewing");
  const [expandedError, setExpandedError] = useState<number | null>(null);

  // A job is "in flight" while queued or generating — poll until it settles.
  const hasInFlight = data.recentJobs.some(
    (j) => j.status === "queued" || j.status === "generating"
  );

  // Live status per (topic, type, model) from the auto-polling recentJobs, so a
  // search row reflects queued → generating → published without manual refresh.
  const liveStatus = new Map<string, string>();
  for (const j of data.recentJobs) {
    const key = `${j.topicId}|${j.contentType}|${j.requestedModel}`;
    if (!liveStatus.has(key)) liveStatus.set(key, j.status); // recentJobs is newest-first
  }

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/admin/auto-content", { cache: "no-store" });
      const json = await res.json();
      if (json?.success) setData(json.data as DashboardData);
    } finally {
      setRefreshing(false);
    }
  }, []);

  // Auto-poll while any job is queued/generating so the admin sees it advance
  // (queued → generating → published/reviewing) without clicking Refresh.
  useEffect(() => {
    if (!hasInFlight) return;
    const timer = setInterval(() => {
      refresh();
    }, 4000);
    return () => clearInterval(timer);
  }, [hasInFlight, refresh]);

  // Debounced syllabus search for the manual "generate for any topic" box.
  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/syllabus/search?q=${encodeURIComponent(q)}&limit=10`,
          { cache: "no-store" }
        );
        const json = await res.json();
        const rows: RawSearchTopic[] = json?.success ? json.data : [];
        const mapped = rows.map((r) => ({
          topicId: r.id,
          topicName: r.title,
          board: r.board?.code ?? null,
          class: r.standard?.grade ?? null,
          subject: r.subject?.name ?? null,
          chapter: r.chapter?.title ?? null,
        }));
        setSearchResults(mapped);

        // Load which content types already exist for these topics.
        const ids = mapped.map((m) => m.topicId);
        if (ids.length > 0) {
          try {
            const jr = await fetch(
              `/api/admin/auto-content/topic-jobs?topicIds=${ids.join(",")}`,
              { cache: "no-store" }
            );
            const jj = await jr.json();
            setExistingByTopic(jj?.success ? jj.data : {});
          } catch {
            setExistingByTopic({});
          }
        } else {
          setExistingByTopic({});
        }
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Lazily load content previews for jobs awaiting review
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const job of reviewingJobs) {
        if (details[job.id] !== undefined) continue;
        try {
          const res = await fetch(`/api/admin/auto-content/${job.id}`, { cache: "no-store" });
          const json = await res.json();
          if (cancelled) return;
          setDetails((d) => ({ ...d, [job.id]: json?.data?.content ?? null }));
          setAudioErrors((m) => ({
            ...m,
            [job.id]: json?.data?.job?.rawOutput?.audioError ?? null,
          }));
        } catch {
          if (!cancelled) setDetails((d) => ({ ...d, [job.id]: null }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.recentJobs]);

  async function refreshExistingFor(topicIds: number[]) {
    if (topicIds.length === 0) return;
    try {
      const res = await fetch(
        `/api/admin/auto-content/topic-jobs?topicIds=${topicIds.join(",")}`,
        { cache: "no-store" }
      );
      const json = await res.json();
      if (json?.success) setExistingByTopic((m) => ({ ...m, ...json.data }));
    } catch {
      /* non-critical */
    }
  }

  async function handleGenerate(topicId: number) {
    const contentType = genType[topicId] ?? "text_note";
    const model = genModel[topicId] ?? "default";
    setBusyTopics((s) => new Set(s).add(topicId));
    try {
      await fetch("/api/admin/auto-content/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topicId, contentType, model }),
      });
      await refresh();
      // Update the "already generated" indicator for this topic.
      await refreshExistingFor([topicId]);
    } finally {
      setBusyTopics((s) => {
        const next = new Set(s);
        next.delete(topicId);
        return next;
      });
    }
  }

  async function handleRetry(job: RecentJob) {
    setBusyJobs((s) => new Set(s).add(job.id));
    try {
      await fetch("/api/admin/auto-content/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topicId: job.topicId, contentType: job.contentType }),
      });
      await refresh();
    } finally {
      setBusyJobs((s) => {
        const next = new Set(s);
        next.delete(job.id);
        return next;
      });
    }
  }

  async function handleReview(jobId: number, action: "approve" | "reject") {
    setBusyJobs((s) => new Set(s).add(jobId));
    try {
      await fetch(`/api/admin/auto-content/${jobId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      await refresh();
    } finally {
      setBusyJobs((s) => {
        const next = new Set(s);
        next.delete(jobId);
        return next;
      });
    }
  }

  const { todayStats, totals } = data;
  const budgetLimit = todayStats.budgetLimit || todayStats.costUsd + todayStats.budgetRemaining || 5;
  const budgetPct = Math.min(100, budgetLimit > 0 ? (todayStats.costUsd / budgetLimit) * 100 : 0);
  const maxDayCost = Math.max(0.0001, ...data.budgetHistory.map((d) => d.cost));

  // Alert conditions
  const budgetExhausted = budgetLimit > 0 && todayStats.costUsd >= budgetLimit;
  const failedToday = todayStats.failed;
  const hasAlerts = budgetExhausted || failedToday > 0;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Auto-Content Pipeline</h1>
          <p className="text-sm text-muted-foreground">
            AI-generated study material — demand, generation, review & cost.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {hasInFlight && (
            <span className="flex items-center gap-1.5 text-xs font-medium text-amber-600">
              <span className="h-2 w-2 animate-pulse rounded-full bg-amber-500" />
              live
            </span>
          )}
          <Button variant="ghost" asChild>
            <Link href="/help/auto-content">
              <HelpCircle className="h-4 w-4" /> Help
            </Link>
          </Button>
          <Button variant="outline" onClick={refresh} disabled={refreshing}>
            {refreshing ? "Refreshing…" : "Refresh"}
          </Button>
        </div>
      </div>

      {/* ---- Quick-start banner (dismissible) ---- */}
      {showQuickStart && (
        <div className="relative rounded-lg border border-violet-500/30 bg-violet-500/5 p-4">
          <button
            onClick={dismissQuickStart}
            className="absolute right-3 top-3 text-muted-foreground hover:text-foreground"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
          <p className="flex items-center gap-2 text-sm font-semibold">
            <HelpCircle className="h-4 w-4 text-violet-600" /> New here? How to generate content
          </p>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
            <li>
              Make sure <code className="rounded bg-muted px-1 text-xs">pnpm workers</code> is
              running — it processes queued jobs.
            </li>
            <li>
              In <span className="font-medium">Top Demand Topics</span>, pick a content type and
              click <span className="font-medium">Generate</span>.
            </li>
            <li>
              Watch <span className="font-medium">Recent Activity</span> — status goes queued →
              generating → published (audio goes to <span className="font-medium">Pending Review</span>).
            </li>
          </ol>
          <Link
            href="/help/auto-content"
            className="mt-2 inline-block text-sm font-medium text-violet-600 hover:underline"
          >
            Read the full guide →
          </Link>
        </div>
      )}

      {/* ---- Alerts: budget exhausted / failed jobs ---- */}
      {hasAlerts && (
        <div className="space-y-2">
          {budgetExhausted && (
            <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
              <span>
                <strong>Daily budget exhausted</strong> ({fmtMoney(todayStats.costUsd)} /{" "}
                {fmtMoney(budgetLimit)}). New generation is paused until the budget resets. Raise{" "}
                <code className="rounded bg-muted px-1 text-xs">DAILY_CONTENT_BUDGET</code> to allow
                more today.
              </span>
            </div>
          )}
          {failedToday > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <span>
                <strong>
                  {failedToday} job{failedToday > 1 ? "s" : ""} failed today.
                </strong>{" "}
                Open the job in <span className="font-medium">Recent Activity</span> to read the
                error, then click <span className="font-medium">Retry</span>.
              </span>
            </div>
          )}
        </div>
      )}

      {/* ---- TOP ROW: 5 stat cards ---- */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Generated Today</CardDescription>
            <CardTitle className="text-3xl text-violet-600">{todayStats.generated}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">{fmtMoney(todayStats.costUsd)} spent</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Pending Review</CardDescription>
            <CardTitle className="flex items-center gap-2 text-3xl">
              {todayStats.pending}
              {todayStats.pending > 0 && <Badge variant="secondary">review</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">awaiting approval</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Published</CardDescription>
            <CardTitle className="text-3xl text-green-600">{totals.published}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">{todayStats.published} today</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Daily Budget</CardDescription>
            <CardTitle className="text-2xl">
              {fmtMoney(todayStats.costUsd)}{" "}
              <span className="text-base text-muted-foreground">/ {fmtMoney(budgetLimit)}</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full rounded-full ${budgetPct >= 100 ? "bg-red-500" : "bg-violet-600"}`}
                style={{ width: `${budgetPct}%` }}
              />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {fmtMoney(todayStats.budgetRemaining)} remaining
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Topics with Content</CardDescription>
            <CardTitle className="text-3xl">{totals.topicsWithContent}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">unique topics covered</p>
          </CardContent>
        </Card>
      </div>

      {/* ---- SECTION 1: Top Demand Topics ---- */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Top Demand Topics</h2>

        {/* Manual generation — search the full syllabus and publish official
            content (not limited to demand topics) to grow the public catalogue. */}
        <Card>
          <CardContent className="space-y-3 p-4">
            <div>
              <p className="text-sm font-medium">Generate for any topic</p>
              <p className="text-xs text-muted-foreground">
                Search the full syllabus and publish official content to promote the app.
              </p>
            </div>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search topics (e.g. Quadratic Equations)…"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
            {searching && <p className="text-xs text-muted-foreground">Searching…</p>}
            {!searching && searchQuery.trim().length >= 2 && searchResults.length === 0 && (
              <p className="text-xs text-muted-foreground">No topics found.</p>
            )}
            {searchResults.length > 0 && (
              <div className="divide-y rounded-md border">
                {searchResults.map((t) => {
                  const existing = existingByTopic[t.topicId] ?? [];
                  const selected = genType[t.topicId] ?? "text_note";
                  const selectedModel = genModel[t.topicId] ?? "default";
                  // Same type AND same model = the item that would be replaced.
                  const selectedExisting = existing.find(
                    (e) =>
                      e.contentType === selected &&
                      e.requestedModel === selectedModel &&
                      !["failed", "rejected"].includes(e.status)
                  );
                  // Live status (auto-polled) for the selected type + model.
                  const live = liveStatus.get(
                    `${t.topicId}|${selected}|${selectedModel}`
                  );
                  const inFlight = live === "queued" || live === "generating";
                  // Whole row is locked while a generation is in progress.
                  const rowBusy = busyTopics.has(t.topicId) || inFlight;
                  const existsActive =
                    !!selectedExisting ||
                    (live != null && !["failed", "rejected"].includes(live));
                  return (
                    <div key={t.topicId} className="space-y-1.5 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{t.topicName}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {[
                              t.board,
                              t.class != null ? `Class ${t.class}` : null,
                              t.subject,
                              t.chapter,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <Select
                            value={selected}
                            disabled={rowBusy}
                            onValueChange={(v) =>
                              setGenType((g) => ({ ...g, [t.topicId]: v as ContentType }))
                            }
                          >
                            <SelectTrigger className="h-8 w-[120px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="text_note">Text Note</SelectItem>
                              <SelectItem value="audio_explainer">Audio</SelectItem>
                              <SelectItem value="question_set">Question Set</SelectItem>
                              <SelectItem value="video_lesson">Video</SelectItem>
                            </SelectContent>
                          </Select>
                          <Select
                            value={selectedModel}
                            disabled={rowBusy}
                            onValueChange={(v) =>
                              setGenModel((g) => ({ ...g, [t.topicId]: v }))
                            }
                          >
                            <SelectTrigger className="h-8 w-[170px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {MODEL_OPTIONS.map((m) => (
                                <SelectItem key={m.value} value={m.value}>
                                  {m.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button
                            size="sm"
                            variant={existsActive ? "outline" : "default"}
                            onClick={() => handleGenerate(t.topicId)}
                            disabled={rowBusy}
                          >
                            {busyTopics.has(t.topicId)
                              ? "…"
                              : inFlight
                                ? "Generating…"
                                : existsActive
                                  ? "Regenerate"
                                  : "Generate"}
                          </Button>
                        </div>
                      </div>

                      {existing.length > 0 && (
                        <p className="text-[11px] text-muted-foreground">
                          Already generated:{" "}
                          {existing
                            .map((e) => {
                              const type =
                                CONTENT_TYPE_LABELS[e.contentType as ContentType] ??
                                e.contentType;
                              const modelLabel =
                                e.requestedModel && e.requestedModel !== "default"
                                  ? ` · ${MODEL_LABEL[e.requestedModel] ?? e.requestedModel}`
                                  : "";
                              return `${type}${modelLabel} (${e.status})`;
                            })
                            .join(", ")}
                        </p>
                      )}
                      {inFlight ? (
                        <p className="flex items-center gap-1.5 text-[11px] font-medium text-amber-600">
                          <span className="h-2 w-2 animate-pulse rounded-full bg-amber-500" />
                          Generating {CONTENT_TYPE_LABELS[selected]} with{" "}
                          {MODEL_LABEL[selectedModel] ?? selectedModel}… ({live})
                        </p>
                      ) : (
                        selectedExisting && (
                          <p className="text-[11px] font-medium text-amber-600">
                            ⚠ {CONTENT_TYPE_LABELS[selected]} with{" "}
                            {MODEL_LABEL[selectedModel] ?? selectedModel} already generated (
                            {selectedExisting.status}) — generating again replaces it. Pick a
                            different model to create another version.
                          </p>
                        )
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Topic</th>
                  <th className="px-4 py-3">Chapter</th>
                  <th className="px-4 py-3">Subject</th>
                  <th className="px-4 py-3">Board</th>
                  <th className="px-4 py-3">Class</th>
                  <th className="px-4 py-3 text-right">Demand</th>
                  <th className="px-4 py-3 text-right">Students</th>
                  <th className="px-4 py-3">Content</th>
                  <th className="px-4 py-3">Generate</th>
                </tr>
              </thead>
              <tbody>
                {data.topDemandTopics.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-4 py-6 text-center text-muted-foreground">
                      No demand signals yet.
                    </td>
                  </tr>
                )}
                {data.topDemandTopics.map((t) => (
                  <tr key={t.topicId} className="border-b last:border-0 hover:bg-muted/40">
                    <td className="px-4 py-3 font-medium">{t.topicName ?? `#${t.topicId}`}</td>
                    <td className="px-4 py-3 text-muted-foreground">{t.chapter ?? "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{t.subject ?? "—"}</td>
                    <td className="px-4 py-3">{t.board ?? "—"}</td>
                    <td className="px-4 py-3">{t.class ?? "—"}</td>
                    <td className="px-4 py-3 text-right font-semibold text-violet-600">
                      {t.demandScore.toFixed(1)}
                    </td>
                    <td className="px-4 py-3 text-right">{t.uniqueStudents}</td>
                    <td className="px-4 py-3">
                      {t.hasExistingContent ? (
                        <Badge className="bg-green-500/15 text-green-600">Yes</Badge>
                      ) : (
                        <Badge variant="outline">None</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Select
                          value={genType[t.topicId] ?? "text_note"}
                          onValueChange={(v) =>
                            setGenType((g) => ({ ...g, [t.topicId]: v as ContentType }))
                          }
                        >
                          <SelectTrigger className="h-8 w-[130px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="text_note">Text Note</SelectItem>
                            <SelectItem value="audio_explainer">Audio</SelectItem>
                            <SelectItem value="question_set">Question Set</SelectItem>
                            <SelectItem value="video_lesson">Video</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button
                          size="sm"
                          onClick={() => handleGenerate(t.topicId)}
                          disabled={busyTopics.has(t.topicId)}
                        >
                          {busyTopics.has(t.topicId) ? "…" : "Generate"}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </section>

      {/* ---- SECTION 2: Pending Review ---- */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Pending Review</h2>
        {reviewingJobs.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing awaiting review.</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {reviewingJobs.map((job) => (
              <Card key={job.id}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">
                      {job.topicName ?? `Topic #${job.topicId}`}
                    </CardTitle>
                    <div className="flex items-center gap-1.5">
                      {job.audioPending && (
                        <Badge className="bg-amber-500/15 text-amber-600">audio pending</Badge>
                      )}
                      <Badge variant="secondary">{job.contentType}</Badge>
                    </div>
                  </div>
                  <CardDescription>Generated {fmtDate(job.createdAt)}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <PendingPreview
                    contentType={job.contentType}
                    detail={details[job.id]}
                    audioError={audioErrors[job.id]}
                  />
                  <div className="flex gap-2 pt-1">
                    <Button
                      size="sm"
                      className="bg-green-600 hover:bg-green-700"
                      onClick={() => handleReview(job.id, "approve")}
                      disabled={busyJobs.has(job.id)}
                    >
                      Approve &amp; Publish
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-red-500 text-red-600 hover:bg-red-500/10"
                      onClick={() => handleReview(job.id, "reject")}
                      disabled={busyJobs.has(job.id)}
                    >
                      Reject
                    </Button>
                    {job.audioPending && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleRetry(job)}
                        disabled={busyJobs.has(job.id)}
                        title="Re-run generation to produce the audio file"
                      >
                        {busyJobs.has(job.id) ? "…" : "Regenerate with audio"}
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* ---- SECTION 3: Recent Activity ---- */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Recent Activity</h2>
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Topic</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Cost</th>
                  <th className="px-4 py-3">Model</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.recentJobs.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">
                      No jobs yet.
                    </td>
                  </tr>
                )}
                {data.recentJobs.map((j) => (
                  <Fragment key={j.id}>
                    <tr className="border-b last:border-0 hover:bg-muted/40">
                      <td className="px-4 py-3">
                        <div className="font-medium">{j.topicName ?? `#${j.topicId}`}</div>
                        {(j.board || j.subject || j.class != null || j.chapter) && (
                          <div className="text-[11px] text-muted-foreground">
                            {[
                              j.board,
                              j.class != null ? `Class ${j.class}` : null,
                              j.subject,
                              j.chapter,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        <span className="flex items-center gap-1.5">
                          {j.contentType}
                          {j.audioPending && (
                            <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-600">
                              audio pending
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={j.status} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        {j.costUsd != null ? fmtMoney(j.costUsd) : "—"}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {j.model ? (
                          <span title={j.model}>
                            {j.provider && j.provider !== "—" ? `${j.provider} · ` : ""}
                            {j.model}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{fmtDate(j.createdAt)}</td>
                      <td className="px-4 py-3">
                        {j.status === "failed" && (
                          <div className="flex gap-1">
                            {j.lastError && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                  setExpandedError(expandedError === j.id ? null : j.id)
                                }
                              >
                                {expandedError === j.id ? "Hide" : "Error"}
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleRetry(j)}
                              disabled={busyJobs.has(j.id)}
                            >
                              {busyJobs.has(j.id) ? "…" : "Retry"}
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                    {expandedError === j.id && j.lastError && (
                      <tr>
                        <td colSpan={7} className="px-4 pb-3">
                          <div className="whitespace-pre-wrap break-words rounded-md border border-red-500/30 bg-red-500/5 p-2 font-mono text-[11px] text-red-700 dark:text-red-400">
                            {j.lastError}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </section>

      {/* ---- SECTION 4: Cost Tracker ---- */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Cost Tracker — last 7 days</h2>
        <Card>
          <CardContent className="pt-6">
            {data.budgetHistory.length === 0 ? (
              <p className="text-sm text-muted-foreground">No spend recorded.</p>
            ) : (
              <div className="flex h-48 items-end gap-3">
                {data.budgetHistory.map((d) => (
                  <div key={d.date} className="flex flex-1 flex-col items-center gap-1">
                    <span className="text-xs font-medium text-muted-foreground">
                      {fmtMoney(d.cost)}
                    </span>
                    <div
                      className="w-full rounded-t bg-violet-600/80"
                      style={{ height: `${Math.max(4, (d.cost / maxDayCost) * 160)}px` }}
                      title={`${d.count} jobs`}
                    />
                    <span className="text-[10px] text-muted-foreground">{d.date.slice(5)}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Per provider/model cost & usage (last 7 days) */}
            <div className="mt-6">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                By provider &amp; model
              </p>
              {(data.costByModel ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No model usage recorded.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="border-b text-left text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-2 py-2">Provider</th>
                      <th className="px-2 py-2">Model</th>
                      <th className="px-2 py-2 text-right">Generations</th>
                      <th className="px-2 py-2 text-right">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.costByModel ?? []).map((m) => (
                      <tr key={m.model} className="border-b last:border-0">
                        <td className="px-2 py-2 capitalize">{m.provider}</td>
                        <td className="px-2 py-2 font-mono text-xs">{m.model}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{m.count}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{fmtMoney(m.cost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pending-review content preview
// ---------------------------------------------------------------------------
function PendingPreview({
  contentType,
  detail,
  audioError,
}: {
  contentType: string;
  detail: JobDetailContent | null | undefined;
  audioError?: string | null;
}) {
  if (detail === undefined) {
    return <p className="text-sm text-muted-foreground">Loading preview…</p>;
  }
  if (detail === null) {
    return <p className="text-sm text-muted-foreground">No content linked.</p>;
  }

  if (contentType === "video_lesson") {
    const embed = youtubeEmbedUrl(detail.mediaUrl);
    return embed ? (
      <div className="aspect-video w-full overflow-hidden rounded-md border">
        <iframe
          src={embed}
          title="Video preview"
          className="h-full w-full"
          allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>
    ) : (
      <p className="text-xs text-muted-foreground">
        No video found.{" "}
        {detail.mediaUrl && (
          <a href={detail.mediaUrl} target="_blank" rel="noopener noreferrer" className="text-violet-600 underline">
            Open link
          </a>
        )}
      </p>
    );
  }

  if (contentType === "audio_explainer") {
    const url = detail.mediaUrl || detail.processedUrl;
    return (
      <div className="space-y-2">
        {url ? (
          <audio controls className="w-full" src={url} />
        ) : (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2">
            <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
              ⚠ Audio not generated — transcript only
            </p>
            {audioError && (
              <p className="mt-1 break-words font-mono text-[11px] text-muted-foreground">
                {audioError}
              </p>
            )}
            <p className="mt-1 text-[11px] text-muted-foreground">
              Fix the provider (key/credits/voice), then click “Regenerate with audio”.
            </p>
          </div>
        )}
        {detail.aiTranscript && (
          <p className="line-clamp-3 text-xs text-muted-foreground">{detail.aiTranscript}</p>
        )}
      </div>
    );
  }

  if (contentType === "question_set") {
    const questions = safeParse<QuestionLike[]>(detail.body) ?? [];
    return (
      <ol className="space-y-2 text-sm">
        {questions.slice(0, 2).map((q, i) => (
          <li key={i} className="rounded-md bg-muted/50 p-2">
            <span className="mr-2 text-xs font-medium text-violet-600">{q.questionType}</span>
            {q.questionText}
          </li>
        ))}
        {questions.length === 0 && (
          <p className="text-xs text-muted-foreground">No questions found.</p>
        )}
      </ol>
    );
  }

  // text_note
  const blocks = safeParse<ContentBlockLike[]>(detail.body) ?? [];
  return (
    <div className="space-y-2">
      {blocks.slice(0, 3).map((b, i) => (
        <BlockPreview key={i} block={b} />
      ))}
      {blocks.length === 0 && <p className="text-xs text-muted-foreground">No blocks found.</p>}
    </div>
  );
}

function BlockPreview({ block }: { block: ContentBlockLike }) {
  switch (block.type) {
    case "heading":
      return <p className="text-sm font-semibold">{block.content}</p>;
    case "text":
    case "callout":
      return <p className="line-clamp-2 text-sm text-muted-foreground">{block.content}</p>;
    case "formula":
      return (
        <code className="block rounded bg-muted px-2 py-1 text-xs">{block.latex}</code>
      );
    case "diagram":
      return <p className="text-xs italic text-muted-foreground">[diagram]</p>;
    case "steps":
      return (
        <p className="line-clamp-2 text-sm text-muted-foreground">
          {(block.items ?? []).join(" → ")}
        </p>
      );
    default:
      return <p className="text-xs italic text-muted-foreground">[{block.type}]</p>;
  }
}

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
