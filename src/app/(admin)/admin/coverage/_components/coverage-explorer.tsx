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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  Trash2,
} from "lucide-react";
import {
  JobStatusCard,
  type ActiveJob,
} from "@/components/coverage/job-status-card";
import {
  SourcePreviewChip,
  type SourcePreview,
} from "@/components/coverage/source-preview-chip";

// ---------------------------------------------------------------------------
// Types (mirror the API payloads)
// ---------------------------------------------------------------------------

// Radix Select disallows empty-string values on SelectItem, so we use this
// sentinel to represent the "all" option in Summary-tab filters and convert
// to/from "" at the boundary.
const ALL = "__all__";

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
    /**
     * Distinct academic years this board has standards for, sorted newest
     * first. Drives the Year dropdown; boards with only one year in the
     * DB still surface it here so the UI shows a single-option Select
     * instead of suddenly hiding the control.
     */
    academicYears: string[];
    grades: Array<{
      grade: number;
      /** Which academic year this grade row belongs to. */
      academicYear: string;
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
  academicYear: string;
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
  filter: { boardCode?: string; grade?: number; subjectName?: string; academicYear?: string };
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

// NOTE: `SourcePreview` / `RecommendedSourceAction` and `ActiveJob` live in
// @/components/coverage/{source-preview-chip,job-status-card} now, so this
// page and /dashboard/syllabus stay in sync. Imported at the top of the file.

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
  /**
   * Academic year filter for the Summary tab. "" = all years. Narrows both
   * the grade dropdown (to grades published in that year) and the server
   * summary query so the grid totals reflect just that year.
   */
  const [sumYear, setSumYear] = useState<string>("");
  const [sumSubjectQ, setSumSubjectQ] = useState<string>("");
  const [sumActionFilter, setSumActionFilter] = useState<"" | RecommendedAction>("");
  const [summary, setSummary] = useState<SummaryReport | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);

  // ------------- Detail-tab state ------------------------------------
  const [boardCode, setBoardCode] = useState<string>("");
  const [grade, setGrade] = useState<number | "">("");
  /**
   * Academic year for the Detail tab. Unlike the Summary tab this is
   * "required" once a board is picked — every standards row has a year,
   * and picking the wrong year loads a different subject set. Defaults
   * to the newest year on the board when the admin picks the board.
   */
  const [academicYear, setAcademicYear] = useState<string>("");
  const [subjectId, setSubjectId] = useState<number | "">("");
  const [report, setReport] = useState<CoverageReport | null>(null);
  const [loadingReport, setLoadingReport] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [running, setRunning] = useState<
    null | "bootstrap" | "fanout" | "autopublish" | "finalize" | "generate_cbse"
  >(null);
  const [banner, setBanner] = useState<{ kind: "ok" | "warn" | "err"; text: string; next?: string } | null>(null);

  // Dual-source availability for the currently-selected subject — feeds the
  // pre-flight chip and the source-aware action bar. Null until the preview
  // endpoint responds; drives which button is primary (Bootstrap NCERT vs.
  // Generate from CBSE vs. Upload) so admins never have to guess.
  const [sourcePreview, setSourcePreview] = useState<SourcePreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  // Track the most recently queued bootstrap job so the Coverage page can
  // poll /api/admin/scrape-jobs/{id} and display live progress + final
  // outcome inline — admins don't have to jump to /scrape-jobs to learn
  // whether their click actually produced any chapters.
  const [activeJob, setActiveJob] = useState<ActiveJob | null>(null);

  // Danger-zone panel visibility + inflight flag for the purge-subject
  // admin action. Hidden by default — only surfaces when the admin expands
  // it, because this destructively wipes curriculum/content rows.
  const [showDanger, setShowDanger] = useState(false);
  const [purging, setPurging] = useState<null | "content" | "chapters" | "subject">(null);

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
  // Grade dropdowns show unique grade numbers. With the year filter
  // present we first narrow to grades matching that year, then dedupe —
  // otherwise Class 10 renders twice when a board has it for both
  // 2025-26 and 2026-27. Summary's year filter is optional ("" = all),
  // Detail's is required once a board is picked.
  const sumBoardGradesForYear = useMemo(() => {
    if (!sumBoardOpt) return [];
    const pool = sumYear
      ? sumBoardOpt.grades.filter((g) => g.academicYear === sumYear)
      : sumBoardOpt.grades;
    const seen = new Set<number>();
    const out: typeof pool = [];
    for (const g of pool) {
      if (seen.has(g.grade)) continue;
      seen.add(g.grade);
      out.push(g);
    }
    return out.sort((a, b) => a.grade - b.grade);
  }, [sumBoardOpt, sumYear]);
  const detailGradesForYear = useMemo(() => {
    if (!boardOpt) return [];
    const pool = academicYear
      ? boardOpt.grades.filter((g) => g.academicYear === academicYear)
      : boardOpt.grades;
    const seen = new Set<number>();
    const out: typeof pool = [];
    for (const g of pool) {
      if (seen.has(g.grade)) continue;
      seen.add(g.grade);
      out.push(g);
    }
    return out.sort((a, b) => a.grade - b.grade);
  }, [boardOpt, academicYear]);
  // Detail's gradeOpt must pin down a SPECIFIC (grade, year) tuple — that's
  // what identifies the underlying standards row and its subject list.
  const gradeOpt = useMemo(
    () =>
      boardOpt?.grades.find(
        (g) => g.grade === grade && (!academicYear || g.academicYear === academicYear)
      ),
    [boardOpt, grade, academicYear]
  );

  // ---- Fetch Summary ---------------------------------------------------
  const fetchSummary = useCallback(async () => {
    setLoadingSummary(true);
    try {
      const qs = new URLSearchParams();
      if (sumBoard) qs.set("board", sumBoard);
      if (sumGrade) qs.set("grade", String(sumGrade));
      if (sumSubjectQ.trim()) qs.set("subject", sumSubjectQ.trim());
      // Pass through when set — the summary route filters on standards.academic_year.
      if (sumYear) qs.set("academicYear", sumYear);
      const res = await fetch(`/api/admin/coverage/summary?${qs.toString()}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message ?? "Failed to load summary");
      setSummary(json.data as SummaryReport);
    } catch (e) {
      setBanner({ kind: "err", text: e instanceof Error ? e.message : "Network error" });
    } finally {
      setLoadingSummary(false);
    }
  }, [sumBoard, sumGrade, sumYear, sumSubjectQ]);

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
  }, [boardCode, grade, subjectId, academicYear]);

  // ---- Pre-flight: dual-source availability check. -------------------
  // Asks /api/admin/coverage/source-preview whether NCERT has a book AND
  // whether a CBSE textbook PDF has already been scraped+parsed, so the
  // action bar can surface the right PRIMARY button (Bootstrap NCERT vs
  // Generate from CBSE vs Upload). Triggered on every subject change.
  useEffect(() => {
    if (!grade || !subjectId) {
      setSourcePreview(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoadingPreview(true);
      try {
        const qs = new URLSearchParams({
          grade: String(grade),
          subjectId: String(subjectId),
        });
        // Thread the Detail tab's pinned year through so the recommendation
        // reads "Grade 10 (2026-27)" instead of just "Grade 10". Skipped
        // when the user hasn't picked a year yet — the API falls back to
        // the subject's own standards row.
        if (academicYear) qs.set("academicYear", academicYear);
        const res = await fetch(`/api/admin/coverage/source-preview?${qs}`);
        const json = await res.json();
        if (cancelled) return;
        if (json.success) setSourcePreview(json.data as SourcePreview);
        else setSourcePreview(null);
      } catch {
        if (!cancelled) setSourcePreview(null);
      } finally {
        if (!cancelled) setLoadingPreview(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [grade, subjectId, academicYear]);

  // ---- Restore any in-flight background job for the current subject on
  //      mount / subject change. Without this the JobStatusCard vanishes
  //      on every page reload even while a cbse_content_fill or subject-
  //      scoped ncert_download is still running in Redis. We query
  //      /api/admin/scrape-jobs?status=queued,running&subjectId=… and
  //      rehydrate activeJob from whichever latest row matches. Only
  //      populates when there's no activeJob already (so we don't clobber
  //      a freshly-queued one the user just clicked).
  useEffect(() => {
    if (!boardCode || !grade || !subjectId) return;
    if (activeJob && activeJob.status !== "completed" && activeJob.status !== "failed" && activeJob.status !== "cancelled") {
      return; // Already tracking something live — don't overwrite.
    }
    let cancelled = false;
    (async () => {
      try {
        const qs = new URLSearchParams({
          status: "queued,running",
          jobType: "cbse_content_fill,ncert_download",
          subjectId: String(subjectId),
          limit: "1",
        });
        const res = await fetch(`/api/admin/scrape-jobs?${qs}`);
        const json = await res.json();
        if (cancelled || !json.success) return;
        const rows = (json.data ?? []) as Array<{
          id: number;
          jobType: string;
          status: ActiveJob["status"];
          itemsFound: number | null;
          itemsProcessed: number | null;
          errorLog: string | null;
          startedAt: string | null;
          completedAt: string | null;
          metadata: Record<string, unknown> | null;
        }>;
        const row = rows[0];
        if (!row) return;
        const subjectLabel = gradeOpt?.subjects.find((s) => s.subjectId === subjectId)?.name ?? "subject";
        const labelPrefix =
          row.jobType === "cbse_content_fill"
            ? "Generate from CBSE"
            : row.jobType === "ncert_download"
            ? "Bootstrap NCERT"
            : row.jobType;
        setActiveJob({
          id: row.id,
          queueJobId: (row.metadata?.queueJobId as string | undefined) ?? undefined,
          jobType: row.jobType,
          status: row.status,
          itemsFound: row.itemsFound ?? 0,
          itemsProcessed: row.itemsProcessed ?? 0,
          errorLog: row.errorLog,
          startedAt: row.startedAt,
          completedAt: row.completedAt,
          displayLabel: `${labelPrefix} — ${boardCode} · Grade ${grade} · ${subjectLabel}`,
        });
      } catch {
        // Best-effort — if the lookup fails the admin can still refresh.
      }
    })();
    return () => {
      cancelled = true;
    };
    // activeJob intentionally excluded from deps: we only want to run on
    // subject change, not every time the polling loop mutates activeJob.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardCode, grade, subjectId, gradeOpt]);

  // ---- Poll the active bootstrap job so the Coverage page shows live
  //      progress + final result without forcing the user to jump to
  //      /scrape-jobs. Stops polling once the job settles.
  useEffect(() => {
    if (!activeJob) return;
    if (activeJob.status === "completed" || activeJob.status === "failed" || activeJob.status === "cancelled") {
      return;
    }
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/admin/scrape-jobs/${activeJob.id}`);
        const json = await res.json();
        if (!json.success) return;
        const row = json.data as {
          id: number;
          status: ActiveJob["status"];
          itemsFound: number;
          itemsProcessed: number;
          errorLog: string | null;
          startedAt: string | null;
          completedAt: string | null;
          jobType: string;
        };
        setActiveJob((prev) =>
          prev
            ? {
                ...prev,
                status: row.status,
                itemsFound: row.itemsFound,
                itemsProcessed: row.itemsProcessed,
                errorLog: row.errorLog,
                startedAt: row.startedAt,
                completedAt: row.completedAt,
              }
            : prev
        );
        if (row.status === "completed" || row.status === "failed" || row.status === "cancelled") {
          // Refresh the coverage view — the worker may have written new rows.
          await Promise.all([fetchReport(), fetchSummary()]);
        }
      } catch {
        // Transient — will retry on next tick.
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [activeJob, fetchReport, fetchSummary]);

  // ---- Drilldown: Summary row → Detail tab ----------------------------
  // Carry the Summary row's academicYear across so the Detail tab's Year
  // picker lands on the same standards as the row the admin clicked —
  // without this a Class 10 click from the 2026-27 row would resolve to
  // the default (newest) year and land on the correct row by coincidence,
  // but a click on the older 2025-26 row would silently switch years.
  const openDetailFor = (row: SummarySubjectRow) => {
    setBoardCode(row.boardCode);
    setAcademicYear(row.academicYear);
    setGrade(row.grade);
    setSubjectId(row.subjectId);
    setTab("detail");
  };

  // ---- Actions ----------------------------------------------------------
  const runAction = async (
    action: "bootstrap" | "fanout" | "autopublish" | "finalize" | "generate_cbse"
  ) => {
    if (!boardCode || !grade || !subjectId) return;

    const subjectLabel = gradeOpt?.subjects.find((s) => s.subjectId === subjectId)?.name ?? "subject";

    // ------------------------------------------------------------------
    // Generate from CBSE textbook — async BullMQ path.
    // Hits /api/admin/content/fill-gaps with { async:true } which inserts a
    // scrape_jobs row, enqueues a cbse_content_fill job, and returns
    // immediately. The existing JobStatusCard + polling loop then surfaces
    // progress as the worker chews through topics. Keeping this async
    // (vs the old inline path) means the request can't time out mid-run
    // for large subjects and the admin can navigate away without losing
    // visibility.
    // ------------------------------------------------------------------
    if (action === "generate_cbse") {
      if (!sourcePreview?.cbseTextbook.available) {
        setBanner({
          kind: "err",
          text: "No CBSE textbook PDF has been scraped for this subject yet. Run the CBSE Syllabus scraper first.",
        });
        return;
      }
      setRunning(action);
      setBanner({
        kind: "ok",
        text: `Queuing content generation for ${sourcePreview.cbseTextbook.topicsMissing} topic(s) from the CBSE textbook PDF…`,
      });
      try {
        const res = await fetch("/api/admin/content/fill-gaps", {
          method: "POST",
          headers: { "content-type": "application/json" },
          // Cap at 500 topics per call — the route's z.max(500).
          // async:true hands work off to BullMQ so the request returns in
          // milliseconds; the worker updates scrape_jobs and we poll it.
          body: JSON.stringify({ subjectId, limit: 500, async: true }),
        });
        const json = await res.json();
        if (!json.success) throw new Error(json.error?.message ?? "Fill-gaps failed");
        const d = json.data;
        const isRunning = d.status === "already_running";
        setBanner({
          kind: "ok",
          text: isRunning
            ? `Fill-gaps already in progress for ${boardCode} · Grade ${grade} · ${subjectLabel} (Job #${d.jobId}).`
            : `Fill-gaps queued — Job #${d.jobId}. Worker will extract content from the CBSE textbook PDF.`,
          next: "Progress appears below; no need to leave this page.",
        });
        setActiveJob({
          id: d.jobId,
          queueJobId: d.queueJobId ?? undefined,
          jobType: "cbse_content_fill",
          status: isRunning ? "running" : "queued",
          itemsFound: 0,
          itemsProcessed: 0,
          errorLog: null,
          startedAt: null,
          completedAt: null,
          displayLabel: `Generate from CBSE — ${boardCode} · Grade ${grade} · ${subjectLabel}`,
        });
      } catch (e) {
        setBanner({ kind: "err", text: e instanceof Error ? e.message : "Network error" });
      } finally {
        // Release the button immediately — actual work runs on the queue
        // and the JobStatusCard owns progress from here on.
        setRunning(null);
      }
      return;
    }

    // Pre-flight for bootstrap: if NCERT has no book for this subject, warn
    // the admin BEFORE queuing a job that we already know will return zero
    // chapters. Still allow override (confirm) in case the catalog is stale
    // or the subject-name mapping is imperfect.
    if (action === "bootstrap" && sourcePreview && !sourcePreview.ncert.available) {
      const suggestions = sourcePreview.suggestions.length
        ? "\n\nSuggested next steps:\n• " + sourcePreview.suggestions.join("\n• ")
        : "";
      const proceed = window.confirm(
        `${sourcePreview.message}${suggestions}\n\nQueue the bootstrap job anyway?`
      );
      if (!proceed) {
        setBanner({
          kind: "warn",
          text: `Bootstrap skipped — ${sourcePreview.message}`,
          next: sourcePreview.suggestions[0],
        });
        return;
      }
    }

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
          // Thread the Detail tab's pinned session through so Bootstrap writes
          // into the right `standards` row. Without this the server falls back
          // to DEFAULT_ACADEMIC_YEAR and the 2026-27 ingest silently targets
          // the 2025-26 tree (the exact bug reported on CBSE Class 10 Math).
          academicYear: academicYear || undefined,
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message ?? "Action failed");
      const d = json.data;

      if (action === "bootstrap") {
        const isRunning = d.status === "already_running";
        setBanner({
          kind: "ok",
          text: isRunning
            ? `Bootstrap already in progress for ${boardCode} · Grade ${grade} · ${subjectLabel} (Job #${d.jobId}).`
            : `Bootstrap queued — Job #${d.jobId}. ${sourcePreview?.ncert.available ? `Will download ${sourcePreview.ncert.books.length} NCERT book(s), ${sourcePreview.ncert.totalChapters} chapter(s).` : "Starting…"}`,
          next: "Progress appears below; no need to leave this page.",
        });
        // Start the live poll — initial state is whatever run just returned.
        setActiveJob({
          id: d.jobId,
          queueJobId: d.queueJobId,
          jobType: "ncert_download",
          status: isRunning ? "running" : "queued",
          itemsFound: 0,
          itemsProcessed: 0,
          errorLog: null,
          startedAt: null,
          completedAt: null,
          displayLabel: `Bootstrap NCERT — ${boardCode} · Grade ${grade} · ${subjectLabel}`,
        });
      } else if (action === "fanout") {
        const cloned = Number(d.topicsCloned ?? 0);
        const handled = Number(d.chaptersHandled ?? 0);
        const skipped = Number(d.chaptersSkippedNoSource ?? 0);
        let next: string | undefined;
        if (cloned === 0 && skipped > 0) {
          next = "No chapter has parsed source content yet. Run Bootstrap NCERT first.";
        } else if (cloned === 0 && handled === 0) {
          next = "Every topic already has content — nothing to fan out. You can run Auto-publish to flip high-quality rows to visible.";
        } else if (skipped > 0) {
          next = `${skipped} chapter(s) had no source row. Run Bootstrap to fetch them, then re-run Fan-out.`;
        } else {
          next = "Next: run Auto-publish to make the newly-cloned content visible to students.";
        }
        setBanner({
          kind: cloned > 0 ? "ok" : "warn",
          text: `Fan-out: ${cloned} topic(s) received chapter content across ${handled} chapter(s)${skipped > 0 ? `; ${skipped} chapter(s) skipped (no source)` : ""}.`,
          next,
        });
      } else if (action === "autopublish") {
        const updated = Number(d.updated ?? 0);
        const candidates = Number(d.candidates ?? 0);
        let next: string | undefined;
        if (candidates === 0) {
          next = "No candidate rows (quality ≥ 0.7, not yet published). Run Fan-out or Bootstrap first to produce content.";
        } else if (updated === 0) {
          next = `${candidates} candidate row(s) exist but nothing was flipped. Check review_status — they may already be 'rejected' or 'auto_approved'.`;
        } else {
          next = "Done. Refresh the chapter tree below to see the newly-published topics.";
        }
        setBanner({
          kind: updated > 0 ? "ok" : "warn",
          text: `Auto-publish: ${updated} row(s) flipped to published/auto_approved (of ${candidates} candidate(s)).`,
          next,
        });
      } else if (action === "finalize") {
        const cloned = Number(d.summary?.topicsCloned ?? 0);
        const published = Number(d.summary?.rowsPublished ?? 0);
        const skipped = Number(d.summary?.chaptersSkippedNoSource ?? 0);
        setBanner({
          kind: published > 0 || cloned > 0 ? "ok" : "warn",
          text: `Finalize: cloned ${cloned} topic(s), published ${published} row(s)${skipped > 0 ? `, ${skipped} chapter(s) skipped (no source)` : ""}.`,
          next:
            skipped > 0
              ? "Run Bootstrap NCERT to fetch the missing chapters, then re-run Finalize."
              : "Coverage numbers above should reflect the new state.",
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
  // Purge — destructive reset for a subject. Used after bug fixes (e.g. the
  // CBSE Sec-PDF class-splitter rollout) where existing rows are known to
  // be contaminated and the admin wants a clean slate before re-scraping.
  // Each scope maps 1:1 to the /api/admin/coverage/purge-subject contract;
  // see that route for the full semantics + cascade notes.
  // ---------------------------------------------------------------------
  const runPurge = async (scope: "content" | "chapters" | "subject") => {
    if (!subjectId) return;
    const subjectLabel =
      gradeOpt?.subjects.find((s) => s.subjectId === subjectId)?.name ?? "subject";
    const scopeDescription =
      scope === "content"
        ? "delete all content_items rows (keeps chapters + topics)"
        : scope === "chapters"
        ? "delete all chapters, topics, and content_items (keeps the subject row)"
        : "delete the subject row itself plus every chapter/topic/content_item below it";
    const proceed = window.confirm(
      `Purge ${boardCode} · Grade ${grade} · ${subjectLabel}\n\nThis will ${scopeDescription}.\n\nThis cannot be undone. Continue?`
    );
    if (!proceed) return;
    setPurging(scope);
    setBanner(null);
    try {
      const res = await fetch("/api/admin/coverage/purge-subject", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subjectId, scope, confirm: true }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message ?? "Purge failed");
      setBanner({
        kind: "ok",
        text: json.data?.message ?? "Purge complete.",
        next:
          scope === "content"
            ? "Re-run Generate from CBSE (or Bootstrap NCERT) to regenerate content for the existing curriculum."
            : scope === "chapters"
            ? "Re-run the CBSE Syllabus scraper for this grade to repopulate chapters + topics, then Generate from CBSE."
            : "The subject row is gone. Re-run the CBSE Syllabus scraper to recreate it.",
      });
      // Refresh everything that depends on subject state.
      await Promise.all([fetchReport(), fetchSummary()]);
      // Re-fetch the source preview so the action bar reflects the new state
      // (CBSE no longer "available", recommended action likely upload_manual).
      if (grade && subjectId && scope !== "subject") {
        const qs = new URLSearchParams({
          grade: String(grade),
          subjectId: String(subjectId),
        });
        if (academicYear) qs.set("academicYear", academicYear);
        const preview = await fetch(`/api/admin/coverage/source-preview?${qs}`);
        const previewJson = await preview.json();
        if (previewJson.success) setSourcePreview(previewJson.data as SourcePreview);
      } else if (scope === "subject") {
        setSourcePreview(null);
      }
    } catch (e) {
      setBanner({ kind: "err", text: e instanceof Error ? e.message : "Network error" });
    } finally {
      setPurging(null);
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
          <div className="flex-1">
            <div>{banner.text}</div>
            {banner.next && (
              <div className="mt-1 text-xs opacity-80">
                <span className="font-medium">Next:</span> {banner.next}
              </div>
            )}
          </div>
          <button className="text-xs underline" onClick={() => setBanner(null)}>
            dismiss
          </button>
        </div>
      )}

      {/* Live job-status card — appears after Bootstrap is queued and
          polls /api/admin/scrape-jobs/{id} every 3s so admins see real
          progress and the final outcome without leaving this page. */}
      {activeJob && (
        <JobStatusCard job={activeJob} onDismiss={() => setActiveJob(null)} />
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
                <Select
                  value={sumBoard === "" ? ALL : sumBoard}
                  onValueChange={(v) => {
                    setSumBoard(v === ALL ? "" : v);
                    setSumGrade("");
                    // Reset year when board changes — its academicYears list
                    // is board-specific. "" ( = all years) is always valid.
                    setSumYear("");
                  }}
                >
                  <SelectTrigger className="h-9 w-[260px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>All boards</SelectItem>
                    {filters?.boards.map((b) => (
                      <SelectItem key={b.code} value={b.code}>
                        {b.code} — {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Year dropdown — only meaningful once a board is picked (each
                  board has its own set of academic years). We still render it
                  when no board is picked, but with "All years" only, so the
                  layout doesn't jump around as admins flip boards. */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-muted-foreground">Year</label>
                <Select
                  value={sumYear === "" ? ALL : sumYear}
                  onValueChange={(v) => {
                    setSumYear(v === ALL ? "" : v);
                    // Narrowing the year can make the current grade invalid
                    // for this board (e.g. Class 10 exists in 2025-26 but
                    // not yet 2026-27) — reset to avoid ghost filters.
                    setSumGrade("");
                  }}
                  disabled={!sumBoardOpt}
                >
                  <SelectTrigger className="h-9 w-[140px]">
                    <SelectValue placeholder="All years" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>All years</SelectItem>
                    {(sumBoardOpt?.academicYears ?? []).map((y) => (
                      <SelectItem key={y} value={y}>
                        {y}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-muted-foreground">Grade</label>
                <Select
                  value={sumGrade === "" ? ALL : String(sumGrade)}
                  onValueChange={(v) => setSumGrade(v === ALL ? "" : Number(v))}
                >
                  <SelectTrigger className="h-9 w-[120px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>All grades</SelectItem>
                    {sumBoardGradesForYear.map((g) => (
                      <SelectItem key={g.grade} value={String(g.grade)}>
                        {g.grade}
                      </SelectItem>
                    ))}
                    {!sumBoardOpt &&
                      Array.from({ length: 12 }, (_, i) => i + 1).map((g) => (
                        <SelectItem key={g} value={String(g)}>
                          {g}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
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
                <Select
                  value={sumActionFilter === "" ? ALL : sumActionFilter}
                  onValueChange={(v) =>
                    setSumActionFilter(v === ALL ? "" : (v as RecommendedAction))
                  }
                >
                  <SelectTrigger className="h-9 w-[220px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>All recommendations</SelectItem>
                    <SelectItem value="done">✓ Done</SelectItem>
                    <SelectItem value="publish_only">→ Publish (no tokens)</SelectItem>
                    <SelectItem value="fanout_only">→ Fan-out (no tokens)</SelectItem>
                    <SelectItem value="bootstrap_needed">✗ Bootstrap (tokens)</SelectItem>
                    <SelectItem value="inspect">Inspect</SelectItem>
                  </SelectContent>
                </Select>
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
                        <th className="px-2 py-2 text-left font-medium">Year</th>
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
                            // subjectId alone is not unique across years when
                            // the same subject row exists for both 2025-26 and
                            // 2026-27 — tack on the year so React keys stay
                            // stable and don't clobber sibling rows.
                            key={`${r.boardCode}-${r.grade}-${r.academicYear}-${r.subjectId}`}
                            className="cursor-pointer border-b last:border-0 hover:bg-muted/30"
                            onClick={() => openDetailFor(r)}
                            title={ACTION_HINT[r.recommendedAction]}
                          >
                            <td className="px-4 py-2 font-mono text-xs">{r.boardCode}</td>
                            <td className="px-2 py-2 text-right font-mono text-xs">{r.grade}</td>
                            <td className="px-2 py-2 font-mono text-xs text-muted-foreground">
                              {r.academicYear}
                            </td>
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
                <Select
                  value={boardCode || undefined}
                  onValueChange={(v) => {
                    setBoardCode(v);
                    // Default to the board's newest year so admins landing
                    // on a board pick up the current session's curriculum
                    // without having to touch the Year dropdown.
                    const picked = filters?.boards.find((b) => b.code === v);
                    setAcademicYear(picked?.academicYears[0] ?? "");
                    setGrade("");
                    setSubjectId("");
                  }}
                >
                  <SelectTrigger className="h-9 w-[260px]">
                    <SelectValue placeholder="Select board…" />
                  </SelectTrigger>
                  <SelectContent>
                    {filters?.boards.map((b) => (
                      <SelectItem key={b.code} value={b.code}>
                        {b.code} — {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Year picker — required once a board is picked. Switching
                  years typically moves you to a different standards row,
                  which has its own subject list, so we reset grade/subject. */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-muted-foreground">Year</label>
                <Select
                  value={academicYear || undefined}
                  onValueChange={(v) => {
                    setAcademicYear(v);
                    setGrade("");
                    setSubjectId("");
                  }}
                  disabled={!boardOpt}
                >
                  <SelectTrigger className="h-9 w-[140px]">
                    <SelectValue placeholder="Select year…" />
                  </SelectTrigger>
                  <SelectContent>
                    {(boardOpt?.academicYears ?? []).map((y) => (
                      <SelectItem key={y} value={y}>
                        {y}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-muted-foreground">Grade</label>
                <Select
                  value={grade === "" ? undefined : String(grade)}
                  onValueChange={(v) => {
                    setGrade(Number(v));
                    setSubjectId("");
                  }}
                  disabled={!boardOpt || !academicYear}
                >
                  <SelectTrigger className="h-9 w-[120px]">
                    <SelectValue placeholder="Select grade…" />
                  </SelectTrigger>
                  <SelectContent>
                    {detailGradesForYear.map((g) => (
                      <SelectItem key={g.grade} value={String(g.grade)}>
                        {g.grade}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-muted-foreground">Subject</label>
                <Select
                  value={subjectId === "" ? undefined : String(subjectId)}
                  onValueChange={(v) => setSubjectId(Number(v))}
                  disabled={!gradeOpt}
                >
                  <SelectTrigger className="h-9 w-[280px]">
                    <SelectValue placeholder="Select subject…" />
                  </SelectTrigger>
                  <SelectContent>
                    {gradeOpt?.subjects.map((s) => (
                      <SelectItem key={s.subjectId} value={String(s.subjectId)}>
                        {s.name} ({s.topicCount} topics)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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

                  {/* Dual-source pre-flight chip — sits above the action bar
                      so the admin sees the availability answer before clicking.
                      Reports BOTH NCERT and CBSE state side-by-side and tells
                      the admin which action the page is recommending. */}
                  {loadingPreview ? (
                    <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Checking NCERT catalog + CBSE scraped PDFs for this subject…
                    </div>
                  ) : sourcePreview ? (
                    <SourcePreviewChip preview={sourcePreview} />
                  ) : null}

                  {/* Source-aware action bar. The primary button is driven
                      by sourcePreview.recommendedAction so an admin landing
                      on a CBSE-only subject (e.g. Computer Applications) is
                      offered "Generate from CBSE textbook" instead of a
                      dead-end NCERT bootstrap. Fan-out / Auto-publish /
                      Finalize remain universal follow-ups. */}
                  <div className="flex flex-wrap items-center gap-2 pt-2">
                    {/* Primary source action — only one of these renders at a time. */}
                    {sourcePreview?.recommendedAction === "generate_from_cbse" ? (
                      <Button
                        onClick={() => runAction("generate_cbse")}
                        disabled={running !== null}
                        className="bg-violet-600 hover:bg-violet-700"
                        title={`Extracts topic-specific content from the already-downloaded CBSE PDF: ${sourcePreview.cbseTextbook.sourcePdf ?? ""}`}
                      >
                        {running === "generate_cbse" ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Sparkles className="mr-2 h-4 w-4" />
                        )}
                        1. Generate from CBSE textbook
                        {sourcePreview.cbseTextbook.topicsMissing > 0 && (
                          <span className="ml-1 opacity-80">
                            ({sourcePreview.cbseTextbook.topicsMissing} topic
                            {sourcePreview.cbseTextbook.topicsMissing === 1 ? "" : "s"})
                          </span>
                        )}
                      </Button>
                    ) : sourcePreview?.recommendedAction === "upload_manual" ? (
                      <Button
                        variant="outline"
                        disabled
                        title="No NCERT book and no CBSE PDF — see the suggestions above."
                      >
                        <AlertTriangle className="mr-2 h-4 w-4" />
                        No automatic source — upload manually
                      </Button>
                    ) : (
                      <Button
                        onClick={() => runAction("bootstrap")}
                        disabled={running !== null}
                        className="bg-violet-600 hover:bg-violet-700"
                        title={
                          sourcePreview && !sourcePreview.ncert.available
                            ? "NCERT has no book for this subject — you'll get a confirmation prompt."
                            : "Download & parse NCERT PDFs for this subject."
                        }
                      >
                        {running === "bootstrap" ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Download className="mr-2 h-4 w-4" />
                        )}
                        1. Bootstrap NCERT
                      </Button>
                    )}

                    {/* Secondary action: offer Bootstrap even when CBSE is
                        primary, so admins can still enrich with NCERT if
                        the catalog has an overlapping book. */}
                    {sourcePreview?.recommendedAction === "generate_from_cbse" &&
                      sourcePreview.ncert.available && (
                        <Button
                          variant="outline"
                          onClick={() => runAction("bootstrap")}
                          disabled={running !== null}
                          title="Optional: NCERT also has a matching book — layer textbook content on top."
                        >
                          {running === "bootstrap" ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <Download className="mr-2 h-4 w-4" />
                          )}
                          Bootstrap NCERT (optional)
                        </Button>
                      )}

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
                    <span className="font-medium">Source priority:</span>{" "}
                    If a CBSE textbook PDF is already scraped, <em>Generate from CBSE textbook</em>{" "}
                    extracts topic-level content directly from it (no fresh download). Otherwise
                    Bootstrap NCERT handles core academic subjects. Fan-out + Auto-publish then
                    propagate and publish the result.
                  </p>

                  {/*
                   * Danger Zone
                   * -----------------------------------------------------------------
                   * Destructive purge actions for when a subject is known-bad and
                   * needs to be rebuilt from scratch. The canonical trigger is the
                   * Sec/Sr_Sec class-splitter rollout: subjects scraped before the
                   * fix are contaminated with the neighbouring grade's topics and
                   * can only be recovered by wiping + re-scraping.
                   *
                   * Collapsed by default so the button doesn't tempt routine use.
                   * Each scope maps 1:1 to /api/admin/coverage/purge-subject:
                   *   content   → nuke content_items only (keep curriculum tree)
                   *   chapters  → nuke chapters + topics + content_items
                   *   subject   → everything above plus the subject row itself
                   *
                   * runPurge() owns the window.confirm prompt and refresh logic.
                   */}
                  <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3">
                    <button
                      type="button"
                      onClick={() => setShowDanger((v) => !v)}
                      className="flex w-full items-center gap-2 text-left text-xs font-medium text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      {showDanger ? "Hide" : "Show"} danger zone
                      <span className="ml-auto font-normal text-muted-foreground">
                        Purge and re-scrape when data is contaminated
                      </span>
                    </button>

                    {showDanger && (
                      <div className="mt-3 space-y-2">
                        <p className="text-xs text-muted-foreground">
                          These actions cannot be undone. Cascade deletes are issued in
                          dependency order. An active <code>cbse_content_fill</code> job for this
                          subject will cause a 409 — cancel it first.
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => runPurge("content")}
                            disabled={purging !== null || running !== null}
                            title="Delete every content_items row under this subject. Chapters and topics stay. Use before re-running Generate from CBSE with a better prompt."
                          >
                            {purging === "content" ? (
                              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="mr-2 h-3.5 w-3.5" />
                            )}
                            Purge content_items
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => runPurge("chapters")}
                            disabled={purging !== null || running !== null}
                            title="Delete chapters + topics + content_items. Subject row stays. Use after the Sec/Sr_Sec class-split fix so the scraper can re-parse into the correct grade."
                          >
                            {purging === "chapters" ? (
                              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="mr-2 h-3.5 w-3.5" />
                            )}
                            Purge chapters + topics
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => runPurge("subject")}
                            disabled={purging !== null || running !== null}
                            title="Delete the subject row itself along with all chapters/topics/content. Use only when the subject was wrongly created."
                          >
                            {purging === "subject" ? (
                              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="mr-2 h-3.5 w-3.5" />
                            )}
                            Purge entire subject
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
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

