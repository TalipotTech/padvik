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

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function CoverageExplorer() {
  const [filters, setFilters] = useState<FiltersPayload | null>(null);
  const [boardCode, setBoardCode] = useState<string>("");
  const [grade, setGrade] = useState<number | "">("");
  const [subjectId, setSubjectId] = useState<number | "">("");

  const [report, setReport] = useState<CoverageReport | null>(null);
  const [loadingFilters, setLoadingFilters] = useState(true);
  const [loadingReport, setLoadingReport] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [running, setRunning] = useState<null | "bootstrap" | "fanout" | "autopublish" | "finalize">(null);
  const [banner, setBanner] = useState<{ kind: "ok" | "warn" | "err"; text: string } | null>(null);

  const [expandedChapters, setExpandedChapters] = useState<Set<number>>(new Set());
  const [showAll, setShowAll] = useState(false); // show all rows including OK topics inside expanded chapter

  // ---- Load filter tree ------------------------------------------------
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/coverage/filters");
        const json = await res.json();
        if (!json.success) throw new Error(json.error?.message ?? "Failed to load filters");
        setFilters(json.data as FiltersPayload);

        // Auto-select CBSE / 10 / Mathematics if available — matches the
        // proven workflow for admins just opening this page.
        const cbse = (json.data as FiltersPayload).boards.find((b) => b.code === "CBSE");
        if (cbse) {
          setBoardCode("CBSE");
          const g10 = cbse.grades.find((g) => g.grade === 10);
          if (g10) {
            setGrade(10);
            const math = g10.subjects.find((s) => /mathematics/i.test(s.name));
            if (math) setSubjectId(math.subjectId);
          }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Network error");
      } finally {
        setLoadingFilters(false);
      }
    })();
  }, []);

  // ---- Derived: current board/grade/subject options -------------------
  const boardOpt = useMemo(
    () => filters?.boards.find((b) => b.code === boardCode),
    [filters, boardCode]
  );
  const gradeOpt = useMemo(
    () => boardOpt?.grades.find((g) => g.grade === grade),
    [boardOpt, grade]
  );

  // ---- Fetch coverage when all three selected --------------------------
  const fetchReport = useCallback(async () => {
    if (!boardCode || !grade || !subjectId) {
      setReport(null);
      return;
    }
    setLoadingReport(true);
    setError(null);
    try {
      const url = `/api/admin/coverage?board=${encodeURIComponent(boardCode)}&grade=${grade}&subject=${subjectId}`;
      const res = await fetch(url);
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message ?? "Failed to load coverage");
      setReport(json.data as CoverageReport);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setLoadingReport(false);
    }
  }, [boardCode, grade, subjectId]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  // When switching board/grade/subject — reset UI state
  useEffect(() => {
    setExpandedChapters(new Set());
  }, [boardCode, grade, subjectId]);

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
      // Refresh the tree
      await fetchReport();
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
  if (error && !filters) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
        <AlertTriangle className="h-10 w-10 text-rose-500" />
        <p className="text-sm text-muted-foreground">Failed to load: {error}</p>
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
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={fetchReport} disabled={loadingReport || !subjectId}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loadingReport ? "animate-spin" : ""}`} />
            Re-audit
          </Button>
        </div>
      </div>

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
              className="h-9 min-w-[200px] rounded-md border bg-background px-2 text-sm disabled:opacity-50"
            >
              <option value="">Select subject…</option>
              {gradeOpt?.subjects.map((s) => (
                <option key={s.subjectId} value={s.subjectId}>
                  {s.name} ({s.topicCount} topics)
                </option>
              ))}
            </select>
          </div>

          <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            <Lightbulb className="h-4 w-4" />
            <span>Defaults to CBSE / 10 / Mathematics — the proven workflow.</span>
          </div>
        </CardContent>
      </Card>

      {/* Banner */}
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

      {/* Summary + actions */}
      {!subjectId && (
        <Card>
          <CardContent className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
            <BookOpen className="h-5 w-5" />
            Pick a Board, Grade, and Subject to audit content coverage.
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
                    <Badge key={b} className={`border ${BUCKET_STYLE[b]}`} variant="outline">
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
                Bootstrap downloads NCERT PDFs and parses one content row per chapter. Fan-out clones each
                chapter&apos;s best row to every orphan topic. Auto-publish flips high-quality (q≥0.7)
                rows to visible.
              </p>
            </CardContent>
          </Card>

          {/* Chapter tree */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">Chapters & topics</CardTitle>
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
                          <Badge className="border border-emerald-500/20 bg-emerald-500/10 text-emerald-700" variant="outline">
                            OK {ch.okCount}/{ch.topics.length}
                          </Badge>
                        ) : (
                          <Badge className="border border-rose-500/20 bg-rose-500/10 text-rose-700" variant="outline">
                            GAP {ch.gapCount}/{ch.topics.length}
                          </Badge>
                        )}
                        {(Object.keys(ch.bucketCounts) as Bucket[])
                          .filter((b) => b !== "ok" && ch.bucketCounts[b] > 0)
                          .map((b) => (
                            <Badge key={b} className={`border text-xs ${BUCKET_STYLE[b]}`} variant="outline">
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
                                  <Badge className={`border ${BUCKET_STYLE[t.bucket]}`} variant="outline">
                                    {BUCKET_LABEL[t.bucket]}
                                  </Badge>
                                </td>
                                <td className="px-2 py-2">{t.title}</td>
                                <td className="px-2 py-2 text-right font-mono text-xs">{t.rowCount}</td>
                                <td className="px-2 py-2 text-right font-mono text-xs">{t.passingCount}</td>
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
                                <td colSpan={7} className="px-4 py-3 text-center text-xs text-muted-foreground">
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
    </div>
  );
}
