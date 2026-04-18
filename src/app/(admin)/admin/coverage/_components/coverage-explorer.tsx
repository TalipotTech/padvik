"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Loader2,
  RefreshCw,
  Download,
  GitBranch,
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  BookOpen,
  Layers,
  Lightbulb,
  ExternalLink,
  Search,
  Sparkles,
  Target,
  Coins,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types (mirror the API payloads)
// ---------------------------------------------------------------------------

type Bucket =
  | "ok"
  | "no_row"
  | "empty_body"
  | "refusal_body"
  | "too_short"
  | "low_quality"
  | "bad_review"
  | "not_published"
  | "unknown";

type RecommendedAction =
  | "done"
  | "publish_only"
  | "fanout_only"
  | "bootstrap_needed"
  | "inspect";

interface FiltersPayload {
  boards: Array<{
    boardId: number;
    code: string;
    name: string;
    grades: Array<{
      grade: number;
      standardIds: number[];
      subjects: Array<{
        subjectId: number;
        standardId: number;
        name: string;
        code: string;
        topicCount: number;
      }>;
    }>;
  }>;
}

interface ClassifiedTopic {
  topicId: number;
  title: string;
  sortOrder: number;
  bucket: Bucket;
  rowCount: number;
  passingCount: number;
  bestQuality: number | null;
  bestRowLength: number | null;
  latestUpdatedAt: string | null;
}

interface CoverageChapter {
  chapterId: number;
  chapterNumber: number;
  title: string;
  topics: ClassifiedTopic[];
  bucketCounts: Record<Bucket, number>;
  okCount: number;
  gapCount: number;
}

interface CoverageSubject {
  boardCode: string;
  boardName: string;
  grade: number;
  subjectId: number;
  subjectName: string;
  subjectCode: string;
  chapters: CoverageChapter[];
  totalTopics: number;
  okCount: number;
  gapCount: number;
  coveragePct: number;
  bucketCounts: Record<Bucket, number>;
}

interface CoverageReport {
  filter: {
    boardCode?: string;
    grade?: number;
    subjectId?: number;
    subjectName?: string;
  };
  subjects: CoverageSubject[];
  topics: ClassifiedTopic[];
  summary: {
    totalTopics: number;
    ok: number;
    gaps: number;
    coveragePct: number;
    buckets: Record<Bucket, number>;
  };
}

interface SummarySubjectRow {
  boardCode: string;
  boardName: string;
  grade: number;
  subjectId: number;
  subjectName: string;
  subjectCode: string;
  totalTopics: number;
  topicsWithAnyContent: number;
  okTopics: number;
  coveragePct: number;
  chapters: number;
  chaptersWithGoodSrc: number;
  rowsTotal: number;
  rowsPublished: number;
  rowsHiQUnpub: number;
  recommendedAction: RecommendedAction;
}

interface SummaryReport {
  filter: { boardCode?: string; grade?: number; subjectName?: string };
  subjects: SummarySubjectRow[];
  totals: {
    subjects: number;
    done: number;
    publishOnly: number;
    fanoutOnly: number;
    bootstrapNeeded: number;
    inspect: number;
    rowsHiQUnpub: number;
    chaptersWithGoodSrc: number;
    rowsHiQUnpubTotal: number;
  };
}

// ---------------------------------------------------------------------------
// Bucket styling
// ---------------------------------------------------------------------------

const BUCKET_LABEL: Record<Bucket, string> = {
  ok: "OK",
  no_row: "NO_ROW",
  empty_body: "EMPTY",
  refusal_body: "REFUSAL",
  too_short: "TOO_SHORT",
  low_quality: "LOW_QUAL",
  bad_review: "BAD_REVIEW",
  not_published: "UNPUB",
  unknown: "UNKNOWN",
};

const BUCKET_STYLE: Record<Bucket, string> = {
  ok: "bg-emerald-500/10 text-emerald-700 border-emerald-500/20",
  no_row: "bg-rose-500/10 text-rose-700 border-rose-500/20",
  empty_body: "bg-amber-500/10 text-amber-700 border-amber-500/20",
  refusal_body: "bg-orange-500/10 text-orange-700 border-orange-500/20",
  too_short: "bg-yellow-500/10 text-yellow-700 border-yellow-500/20",
  low_quality: "bg-orange-500/10 text-orange-700 border-orange-500/20",
  bad_review: "bg-violet-500/10 text-violet-700 border-violet-500/20",
  not_published: "bg-slate-500/10 text-slate-700 border-slate-500/20",
  unknown: "bg-zinc-500/10 text-zinc-700 border-zinc-500/20",
};

const ACTION_LABEL: Record<RecommendedAction, string> = {
  done: "Done",
  publish_only: "Publish",
  fanout_only: "Fan-out",
  bootstrap_needed: "Bootstrap",
  inspect: "Inspect",
};

const ACTION_STYLE: Record<RecommendedAction, string> = {
  done: "bg-emerald-500/10 text-emerald-700 border-emerald-500/20",
  publish_only: "bg-sky-500/10 text-sky-700 border-sky-500/20",
  fanout_only: "bg-violet-500/10 text-violet-700 border-violet-500/20",
  bootstrap_needed: "bg-amber-500/10 text-amber-700 border-amber-500/20",
  inspect: "bg-zinc-500/10 text-zinc-700 border-zinc-500/20",
};

const ACTION_HINT: Record<RecommendedAction, string> = {
  done: "Everything covered — no action required.",
  publish_only: "High-quality rows already parsed. Just flip is_published — zero AI tokens.",
  fanout_only: "Chapter has parsed content to clone onto orphan topics — zero AI tokens.",
  bootstrap_needed: "Missing NCERT source — queue bootstrap (downloads PDF, costs AI tokens).",
  inspect: "Classification edge case — open Detail tab to see per-topic buckets.",
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function CoverageExplorer() {
  const [filters, setFilters] = useState<FiltersPayload | null>(null);
  const [loadingFilters, setLoadingFilters] = useState(true);
  const [globalError, setGlobalError] = useState<string | null>(null);

  // Tab state
  const [tab, setTab] = useState<"summary" | "detail">("summary");

  // ------------- Summary-tab state -----------------------------------
  const [sumBoard, setSumBoard] = useState<string>("");
  const [sumGrade, setSumGrade] = useState<number | "">("");
  const [sumSubjectQ, setSumSubjectQ] = useState<string>("");
  const [sumActionFilter, setSumActionFilter] = useState<"" | RecommendedAction>("");
  const [summary, setSummary] = useState<SummaryReport | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);

  // ------------- Detail-tab state ------------------------------------
  const [boardCode, setBoardCode] = useState<string>("");
  const [grade, setGrade] = useState<number | "">("");
  const [subjectId, setSubjectId] = useState<number | "">("");
  const [report, setReport] = useState<CoverageReport | null>(null);
  const [loadingReport, setLoadingReport] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [running, setRunning] = useState<null | "bootstrap" | "fanout" | "autopublish" | "finalize">(null);
  const [banner, setBanner] = useState<{ kind: "ok" | "warn" | "err"; text: string } | null>(null);

  const [expandedChapters, setExpandedChapters] = useState<Set<number>>(new Set());
  const [showAll, setShowAll] = useState(false);

  // ---- Load filter tree ------------------------------------------------
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/coverage/filters");
        const json = await res.json();
        if (!json.success) throw new Error(json.error?.message ?? "Failed to load filters");
        setFilters(json.data as FiltersPayload);
      } catch (e) {
        setGlobalError(e instanceof Error ? e.message : "Network error");
      } finally {
        setLoadingFilters(false);
      }
    })();
  }, []);

  // ---- Derived: current board/grade options for both tabs --------------
  const sumBoardOpt = useMemo(
    () => filters?.boards.find((b) => b.code === sumBoard),
    [filters, sumBoard]
  );
  const boardOpt = useMemo(
    () => filters?.boards.find((b) => b.code === boardCode),
    [filters, boardCode]
  );
  const gradeOpt = useMemo(
    () => boardOpt?.grades.find((g) => g.grade === grade),
    [boardOpt, grade]
  );

  // ---- Fetch Summary ---------------------------------------------------
  const fetchSummary = useCallback(async () => {
    setLoadingSummary(true);
    try {
      const qs = new URLSearchParams();
      if (sumBoard) qs.set("board", sumBoard);
      if (sumGrade) qs.set("grade", String(sumGrade));
      if (sumSubjectQ.trim()) qs.set("subject", sumSubjectQ.trim());
      const res = await fetch(`/api/admin/coverage/summary?${qs.toString()}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message ?? "Failed to load summary");
      setSummary(json.data as SummaryReport);
    } catch (e) {
      setBanner({ kind: "err", text: e instanceof Error ? e.message : "Network error" });
    } finally {
      setLoadingSummary(false);
    }
  }, [sumBoard, sumGrade, sumSubjectQ]);

  useEffect(() => {
    if (tab === "summary" && filters) fetchSummary();
  }, [tab, filters, fetchSummary]);

  const summaryRows = useMemo(() => {
    if (!summary) return [];
    return sumActionFilter
      ? summary.subjects.filter((s) => s.recommendedAction === sumActionFilter)
      : summary.subjects;
  }, [summary, sumActionFilter]);

  // ---- Fetch Detail ---------------------------------------------------
  const fetchReport = useCallback(async () => {
    if (!boardCode || !grade || !subjectId) {
      setReport(null);
      return;
    }
    setLoadingReport(true);
    setDetailError(null);
    try {
      const url = `/api/admin/coverage?board=${encodeURIComponent(boardCode)}&grade=${grade}&subject=${subjectId}`;
      const res = await fetch(url);
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message ?? "Failed to load coverage");
      setReport(json.data as CoverageReport);
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : "Network error");
    } finally {
      setLoadingReport(false);
    }
  }, [boardCode, grade, subjectId]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  useEffect(() => {
    setExpandedChapters(new Set());
  }, [boardCode, grade, subjectId]);

  // ---- Drilldown: Summary row → Detail tab ----------------------------
  const openDetailFor = (row: SummarySubjectRow) => {
    setBoardCode(row.boardCode);
    setGrade(row.grade);
    setSubjectId(row.subjectId);
    setTab("detail");
  };

  // ---- Actions ----------------------------------------------------------
  const runAction = async (action: "bootstrap" | "fanout" | "autopublish" | "finalize") => {
    if (!boardCode || !grade || !subjectId) return;
    setRunning(action);
    setBanner(null);
    try {
      const res = await fetch("/api/admin/coverage/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          board: boardCode,
          grade,
          subjectId,
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message ?? "Action failed");
      const d = json.data;
      if (action === "bootstrap") {
        setBanner({
          kind: "ok",
          text: d.status === "already_running"
            ? `Bootstrap already in progress (Job #${d.jobId}). Watch /scrape-jobs.`
            : `Bootstrap queued — Job #${d.jobId}. Watch /scrape-jobs for progress.`,
        });
      } else if (action === "fanout") {
        setBanner({
          kind: "ok",
          text: `Fan-out: ${d.topicsCloned} topic(s) received chapter content across ${d.chaptersHandled} chapter(s). ${d.chaptersSkippedNoSource > 0 ? `${d.chaptersSkippedNoSource} chapter(s) skipped — run Bootstrap first.` : ""}`,
        });
      } else if (action === "autopublish") {
        setBanner({
          kind: "ok",
          text: `Auto-publish: ${d.updated} row(s) flipped to published/auto_approved (candidates ${d.candidates}).`,
        });
      } else if (action === "finalize") {
        setBanner({
          kind: "ok",
          text: `Finalize: cloned ${d.summary.topicsCloned} topic(s), published ${d.summary.rowsPublished} row(s).`,
        });
      }
      // Refresh whatever's visible
      await Promise.all([fetchReport(), fetchSummary()]);
    } catch (e) {
      setBanner({ kind: "err", text: e instanceof Error ? e.message : "Network error" });
    } finally {
      setRunning(null);
    }
  };

  // ---------------------------------------------------------------------
  // Render — loading / error
  // ---------------------------------------------------------------------
  if (loadingFilters) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-violet-600" />
      </div>
    );
  }
  if (globalError && !filters) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
        <AlertTriangle className="h-10 w-10 text-rose-500" />
        <p className="text-sm text-muted-foreground">Failed to load: {globalError}</p>
        <Button variant="outline" onClick={() => window.location.reload()}>Retry</Button>
      </div>
    );
  }

  const subject = report?.subjects[0];

  return (
    <div className="space-y-6">
      {/* Heading */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Curriculum Coverage</h1>
          <p className="text-sm text-muted-foreground">
            One-point view of content availability per Board → Grade → Subject, with one-click ingest.
          </p>
        </div>
      </div>

      {/* Banner (shared across tabs) */}
      {banner && (
        <div
          className={`flex items-start gap-3 rounded-md border p-3 text-sm ${
            banner.kind === "ok"
              ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-800"
              : banner.kind === "warn"
              ? "border-amber-500/20 bg-amber-500/5 text-amber-800"
              : "border-rose-500/20 bg-rose-500/5 text-rose-800"
          }`}
        >
          {banner.kind === "ok" ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          <div className="flex-1">{banner.text}</div>
          <button className="text-xs underline" onClick={() => setBanner(null)}>
            dismiss
          </button>
        </div>
      )}

      <Tabs value={tab} onValueChange={(v) => setTab(v as "summary" | "detail")}>
        <TabsList>
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="detail">Detail</TabsTrigger>
        </TabsList>

        {/* ================================================================
            SUMMARY TAB — grid across all subjects + reuse affordances
            ================================================================ */}
        <TabsContent value="summary" className="space-y-4">
          {/* Filter bar */}
          <Card>
            <CardContent className="flex flex-wrap items-end gap-3 p-4">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-muted-foreground">Board</label>
                <select
                  value={sumBoard}
                  onChange={(e) => {
                    setSumBoard(e.target.value);
                    setSumGrade("");
                  }}
                  className="h-9 min-w-[140px] rounded-md border bg-background px-2 text-sm"
                >
                  <option value="">All boards</option>
                  {filters?.boards.map((b) => (
                    <option key={b.code} value={b.code}>
                      {b.code}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-muted-foreground">Grade</label>
                <select
                  value={sumGrade}
                  onChange={(e) => setSumGrade(e.target.value ? Number(e.target.value) : "")}
                  className="h-9 min-w-[100px] rounded-md border bg-background px-2 text-sm"
                >
                  <option value="">All grades</option>
                  {(sumBoardOpt?.grades ?? []).map((g) => (
                    <option key={g.grade} value={g.grade}>
                      {g.grade}
                    </option>
                  ))}
                  {!sumBoardOpt &&
                    Array.from({ length: 12 }, (_, i) => i + 1).map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-muted-foreground">Subject search</label>
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={sumSubjectQ}
                    onChange={(e) => setSumSubjectQ(e.target.value)}
                    placeholder="e.g. math, science"
                    className="h-9 w-[200px] pl-8 text-sm"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-muted-foreground">Action</label>
                <select
                  value={sumActionFilter}
                  onChange={(e) => setSumActionFilter(e.target.value as "" | RecommendedAction)}
                  className="h-9 min-w-[180px] rounded-md border bg-background px-2 text-sm"
                >
                  <option value="">All recommendations</option>
                  <option value="done">✓ Done</option>
                  <option value="publish_only">→ Publish (no tokens)</option>
                  <option value="fanout_only">→ Fan-out (no tokens)</option>
                  <option value="bootstrap_needed">✗ Bootstrap (tokens)</option>
                  <option value="inspect">Inspect</option>
                </select>
              </div>

              <div className="ml-auto">
                <Button variant="outline" size="sm" onClick={fetchSummary} disabled={loadingSummary}>
                  <RefreshCw className={`mr-2 h-4 w-4 ${loadingSummary ? "animate-spin" : ""}`} />
                  Refresh
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Totals strip */}
          {summary && (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              <StatCard
                icon={<Target className="h-4 w-4" />}
                label="Subjects in scope"
                value={summary.totals.subjects}
              />
              <StatCard
                icon={<CheckCircle2 className="h-4 w-4 text-emerald-600" />}
                label="Done"
                value={summary.totals.done}
                tone="emerald"
              />
              <StatCard
                icon={<Sparkles className="h-4 w-4 text-sky-600" />}
                label="Publish-only"
                value={summary.totals.publishOnly}
                sub={`${summary.totals.rowsHiQUnpub} rows to flip`}
                tone="sky"
              />
              <StatCard
                icon={<GitBranch className="h-4 w-4 text-violet-600" />}
                label="Fan-out only"
                value={summary.totals.fanoutOnly}
                sub={`${summary.totals.chaptersWithGoodSrc} reusable chapters`}
                tone="violet"
              />
              <StatCard
                icon={<Coins className="h-4 w-4 text-amber-600" />}
                label="Bootstrap needed"
                value={summary.totals.bootstrapNeeded}
                sub="costs AI tokens"
                tone="amber"
              />
            </div>
          )}

          {/* Grid */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">
                All subjects
                {summary && (
                  <span className="ml-2 text-sm font-normal text-muted-foreground">
                    ({summaryRows.length}
                    {sumActionFilter ? ` of ${summary.totals.subjects}` : ""})
                  </span>
                )}
              </CardTitle>
              <span className="text-xs text-muted-foreground">
                Click a row to open in Detail tab.
              </span>
            </CardHeader>
            <CardContent className="p-0">
              {loadingSummary && !summary ? (
                <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading summary…
                </div>
              ) : summaryRows.length === 0 ? (
                <div className="p-10 text-center text-sm text-muted-foreground">
                  No subjects match the current filters.
                </div>
              ) : (
                <div className="max-h-[70vh] overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 z-10 bg-background">
                      <tr className="border-b text-xs text-muted-foreground">
                        <th className="px-4 py-2 text-left font-medium">Board</th>
                        <th className="px-2 py-2 text-right font-medium">Grade</th>
                        <th className="px-2 py-2 text-left font-medium">Subject</th>
                        <th className="px-2 py-2 text-right font-medium">Topics</th>
                        <th className="px-2 py-2 text-right font-medium">Coverage</th>
                        <th className="px-2 py-2 text-right font-medium">Rows&nbsp;(pub)</th>
                        <th className="px-2 py-2 text-right font-medium">Hi-Q unpub</th>
                        <th className="px-2 py-2 text-right font-medium">Ch / src</th>
                        <th className="px-4 py-2 text-left font-medium">Recommendation</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summaryRows.map((r) => {
                        const pctClass =
                          r.coveragePct === 100
                            ? "text-emerald-600"
                            : r.coveragePct >= 50
                            ? "text-amber-600"
                            : "text-rose-600";
                        return (
                          <tr
                            key={`${r.boardCode}-${r.grade}-${r.subjectId}`}
                            className="cursor-pointer border-b last:border-0 hover:bg-muted/30"
                            onClick={() => openDetailFor(r)}
                            title={ACTION_HINT[r.recommendedAction]}
                          >
                            <td className="px-4 py-2 font-mono text-xs">{r.boardCode}</td>
                            <td className="px-2 py-2 text-right font-mono text-xs">{r.grade}</td>
                            <td className="px-2 py-2">{r.subjectName}</td>
                            <td className="px-2 py-2 text-right font-mono text-xs">
                              {r.okTopics}/{r.totalTopics}
                            </td>
                            <td className={`px-2 py-2 text-right font-mono text-xs font-medium ${pctClass}`}>
                              {r.coveragePct}%
                            </td>
                            <td className="px-2 py-2 text-right font-mono text-xs">
                              {r.rowsTotal}
                              <span className="text-muted-foreground">
                                {" "}
                                ({r.rowsPublished})
                              </span>
                            </td>
                            <td className="px-2 py-2 text-right font-mono text-xs">
                              {r.rowsHiQUnpub > 0 ? (
                                <span className="text-sky-700">{r.rowsHiQUnpub}</span>
                              ) : (
                                "0"
                              )}
                            </td>
                            <td className="px-2 py-2 text-right font-mono text-xs">
                              {r.chaptersWithGoodSrc}/{r.chapters}
                            </td>
                            <td className="px-4 py-2">
                              <Badge
                                variant="outline"
                                className={`border ${ACTION_STYLE[r.recommendedAction]}`}
                              >
                                {ACTION_LABEL[r.recommendedAction]}
                              </Badge>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          <p className="text-xs text-muted-foreground">
            <Lightbulb className="mr-1 inline h-3 w-3" />
            <span className="font-medium">Prefer reuse over re-download:</span>{" "}
            <span className="text-sky-700">Publish-only</span> and{" "}
            <span className="text-violet-700">Fan-out only</span> subjects cost zero AI tokens.
            Bootstrap (amber) re-downloads and re-parses NCERT PDFs — only use when the chapter
            genuinely lacks a parsed source row.
          </p>
        </TabsContent>

        {/* ================================================================
            DETAIL TAB — the existing per-subject deep dive
            ================================================================ */}
        <TabsContent value="detail" className="space-y-4">
          {/* Filter bar */}
          <Card>
            <CardContent className="flex flex-wrap items-end gap-3 p-4">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-muted-foreground">Board</label>
                <select
                  value={boardCode}
                  onChange={(e) => {
                    setBoardCode(e.target.value);
                    setGrade("");
                    setSubjectId("");
                  }}
                  className="h-9 min-w-[120px] rounded-md border bg-background px-2 text-sm"
                >
                  <option value="">Select board…</option>
                  {filters?.boards.map((b) => (
                    <option key={b.code} value={b.code}>
                      {b.code} — {b.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-muted-foreground">Grade</label>
                <select
                  value={grade}
                  onChange={(e) => {
                    setGrade(e.target.value ? Number(e.target.value) : "");
                    setSubjectId("");
                  }}
                  disabled={!boardOpt}
                  className="h-9 min-w-[90px] rounded-md border bg-background px-2 text-sm disabled:opacity-50"
                >
                  <option value="">Select grade…</option>
                  {boardOpt?.grades.map((g) => (
                    <option key={g.grade} value={g.grade}>
                      {g.grade}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-muted-foreground">Subject</label>
                <select
                  value={subjectId}
                  onChange={(e) => setSubjectId(e.target.value ? Number(e.target.value) : "")}
                  disabled={!gradeOpt}
                  className="h-9 min-w-[260px] rounded-md border bg-background px-2 text-sm disabled:opacity-50"
                >
                  <option value="">Select subject…</option>
                  {gradeOpt?.subjects.map((s) => (
                    <option key={s.subjectId} value={s.subjectId}>
                      {s.name} ({s.topicCount} topics)
                    </option>
                  ))}
                </select>
              </div>

              <div className="ml-auto flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={fetchReport}
                  disabled={loadingReport || !subjectId}
                >
                  <RefreshCw className={`mr-2 h-4 w-4 ${loadingReport ? "animate-spin" : ""}`} />
                  Re-audit
                </Button>
              </div>
            </CardContent>
          </Card>

          {!subjectId && (
            <Card>
              <CardContent className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
                <BookOpen className="h-5 w-5" />
                Pick a Board, Grade, and Subject to audit content coverage — or click a row in the
                Summary tab.
              </CardContent>
            </Card>
          )}

          {detailError && (
            <Card>
              <CardContent className="flex items-center gap-3 p-6 text-sm text-rose-700">
                <AlertTriangle className="h-5 w-5" />
                {detailError}
              </CardContent>
            </Card>
          )}

          {subjectId && loadingReport && !report && (
            <Card>
              <CardContent className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" /> Auditing…
              </CardContent>
            </Card>
          )}

          {subject && (
            <>
              <Card>
                <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
                  <div>
                    <CardTitle className="text-lg">
                      {subject.boardCode} · Grade {subject.grade} · {subject.subjectName}
                    </CardTitle>
                    <CardDescription>
                      {subject.totalTopics} topics across {subject.chapters.length} chapter
                      {subject.chapters.length === 1 ? "" : "s"}.
                    </CardDescription>
                  </div>
                  <div className="text-right">
                    <div
                      className={`text-3xl font-bold tracking-tight ${
                        subject.coveragePct === 100
                          ? "text-emerald-600"
                          : subject.coveragePct >= 80
                          ? "text-amber-600"
                          : "text-rose-600"
                      }`}
                    >
                      {subject.coveragePct}%
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {subject.okCount}/{subject.totalTopics} covered
                    </div>
                  </div>
                </CardHeader>

                <Separator />

                <CardContent className="space-y-4 p-6">
                  {/* Bucket breakdown */}
                  <div className="flex flex-wrap items-center gap-2">
                    {(Object.keys(subject.bucketCounts) as Bucket[])
                      .filter((b) => subject.bucketCounts[b] > 0)
                      .map((b) => (
                        <Badge
                          key={b}
                          className={`border ${BUCKET_STYLE[b]}`}
                          variant="outline"
                        >
                          {BUCKET_LABEL[b]}: {subject.bucketCounts[b]}
                        </Badge>
                      ))}
                  </div>

                  {/* Action bar */}
                  <div className="flex flex-wrap items-center gap-2 pt-2">
                    <Button
                      onClick={() => runAction("bootstrap")}
                      disabled={running !== null}
                      className="bg-violet-600 hover:bg-violet-700"
                    >
                      {running === "bootstrap" ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Download className="mr-2 h-4 w-4" />
                      )}
                      1. Bootstrap NCERT
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => runAction("fanout")}
                      disabled={running !== null || subject.totalTopics === 0}
                    >
                      {running === "fanout" ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <GitBranch className="mr-2 h-4 w-4" />
                      )}
                      2. Fan-out chapters → topics
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => runAction("autopublish")}
                      disabled={running !== null}
                    >
                      {running === "autopublish" ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <CheckCircle2 className="mr-2 h-4 w-4" />
                      )}
                      3. Auto-publish high-quality
                    </Button>
                    <div className="flex-1" />
                    <Button
                      variant="secondary"
                      onClick={() => runAction("finalize")}
                      disabled={running !== null}
                      title="Runs fan-out + auto-publish as one step (for after bootstrap completes)."
                    >
                      {running === "finalize" ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Layers className="mr-2 h-4 w-4" />
                      )}
                      Finalize (2 + 3)
                    </Button>
                    <Button asChild variant="ghost" size="sm">
                      <Link href="/scrape-jobs" target="_blank">
                        <ExternalLink className="mr-1 h-3 w-3" />
                        Jobs
                      </Link>
                    </Button>
                  </div>

                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium">Proven flow (CBSE 10 Math):</span>{" "}
                    Bootstrap downloads NCERT PDFs and parses one content row per chapter. Fan-out
                    clones each chapter&apos;s best row to every orphan topic. Auto-publish flips
                    high-quality (q≥0.7) rows to visible.
                  </p>
                </CardContent>
              </Card>

              {/* Chapter tree */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0">
                  <CardTitle className="text-base">Chapters &amp; topics</CardTitle>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={showAll}
                      onChange={(e) => setShowAll(e.target.checked)}
                      className="h-3 w-3"
                    />
                    Show OK topics inside expanded chapters
                  </label>
                </CardHeader>
                <CardContent className="space-y-2 p-4">
                  {subject.chapters.map((ch) => {
                    const expanded = expandedChapters.has(ch.chapterId);
                    const toggle = () => {
                      const next = new Set(expandedChapters);
                      if (expanded) next.delete(ch.chapterId);
                      else next.add(ch.chapterId);
                      setExpandedChapters(next);
                    };
                    const topicsToShow = showAll || ch.gapCount === 0
                      ? ch.topics
                      : ch.topics.filter((t) => t.bucket !== "ok");

                    return (
                      <div key={ch.chapterId} className="overflow-hidden rounded-md border">
                        <button
                          onClick={toggle}
                          className="flex w-full items-center gap-3 bg-muted/30 px-4 py-2 text-left transition-colors hover:bg-muted/50"
                        >
                          {expanded ? (
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          )}
                          <span className="font-mono text-xs text-muted-foreground">
                            Ch{String(ch.chapterNumber).padStart(2, "0")}
                          </span>
                          <span className="font-medium">{ch.title}</span>
                          <span className="text-xs text-muted-foreground">
                            ({ch.topics.length} topic{ch.topics.length === 1 ? "" : "s"})
                          </span>
                          <div className="ml-auto flex items-center gap-1.5">
                            {ch.gapCount === 0 ? (
                              <Badge
                                className="border border-emerald-500/20 bg-emerald-500/10 text-emerald-700"
                                variant="outline"
                              >
                                OK {ch.okCount}/{ch.topics.length}
                              </Badge>
                            ) : (
                              <Badge
                                className="border border-rose-500/20 bg-rose-500/10 text-rose-700"
                                variant="outline"
                              >
                                GAP {ch.gapCount}/{ch.topics.length}
                              </Badge>
                            )}
                            {(Object.keys(ch.bucketCounts) as Bucket[])
                              .filter((b) => b !== "ok" && ch.bucketCounts[b] > 0)
                              .map((b) => (
                                <Badge
                                  key={b}
                                  className={`border text-xs ${BUCKET_STYLE[b]}`}
                                  variant="outline"
                                >
                                  {BUCKET_LABEL[b]} {ch.bucketCounts[b]}
                                </Badge>
                              ))}
                          </div>
                        </button>

                        {expanded && (
                          <div className="border-t bg-background">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="border-b text-xs text-muted-foreground">
                                  <th className="px-4 py-2 text-left font-medium">Status</th>
                                  <th className="px-2 py-2 text-left font-medium">Topic</th>
                                  <th className="px-2 py-2 text-right font-medium">Rows</th>
                                  <th className="px-2 py-2 text-right font-medium">Pass</th>
                                  <th className="px-2 py-2 text-right font-medium">Best q</th>
                                  <th className="px-2 py-2 text-right font-medium">Best len</th>
                                  <th className="px-4 py-2 text-right font-medium">Preview</th>
                                </tr>
                              </thead>
                              <tbody>
                                {topicsToShow.map((t) => (
                                  <tr key={t.topicId} className="border-b last:border-0">
                                    <td className="px-4 py-2">
                                      <Badge
                                        className={`border ${BUCKET_STYLE[t.bucket]}`}
                                        variant="outline"
                                      >
                                        {BUCKET_LABEL[t.bucket]}
                                      </Badge>
                                    </td>
                                    <td className="px-2 py-2">{t.title}</td>
                                    <td className="px-2 py-2 text-right font-mono text-xs">
                                      {t.rowCount}
                                    </td>
                                    <td className="px-2 py-2 text-right font-mono text-xs">
                                      {t.passingCount}
                                    </td>
                                    <td className="px-2 py-2 text-right font-mono text-xs">
                                      {t.bestQuality != null ? t.bestQuality.toFixed(2) : "—"}
                                    </td>
                                    <td className="px-2 py-2 text-right font-mono text-xs">
                                      {t.bestRowLength ?? "—"}
                                    </td>
                                    <td className="px-4 py-2 text-right">
                                      <Link
                                        href={`/dashboard/learn/${t.topicId}`}
                                        target="_blank"
                                        className="text-xs text-violet-600 hover:underline"
                                      >
                                        learn <ExternalLink className="inline h-3 w-3" />
                                      </Link>
                                    </td>
                                  </tr>
                                ))}
                                {topicsToShow.length === 0 && (
                                  <tr>
                                    <td
                                      colSpan={7}
                                      className="px-4 py-3 text-center text-xs text-muted-foreground"
                                    >
                                      All topics OK — toggle &quot;Show OK topics&quot; to view.
                                    </td>
                                  </tr>
                                )}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {subject.chapters.length === 0 && (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                      No chapters found for this subject. Seed the syllabus first.
                    </p>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small presentational helper for the summary totals strip.
// ---------------------------------------------------------------------------

function StatCard({
  icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  sub?: string;
  tone?: "emerald" | "sky" | "violet" | "amber";
}) {
  const toneClass =
    tone === "emerald"
      ? "border-emerald-500/20 bg-emerald-500/5"
      : tone === "sky"
      ? "border-sky-500/20 bg-sky-500/5"
      : tone === "violet"
      ? "border-violet-500/20 bg-violet-500/5"
      : tone === "amber"
      ? "border-amber-500/20 bg-amber-500/5"
      : "";
  return (
    <div className={`rounded-md border p-3 ${toneClass}`}>
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-2xl font-bold tracking-tight">{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}
