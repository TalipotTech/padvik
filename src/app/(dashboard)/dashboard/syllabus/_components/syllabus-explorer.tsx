"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  BookOpen, ChevronRight, ChevronDown, ChevronLeft, ChevronsLeft, ChevronsRight,
  FileText, Layers, Search, Filter, CheckCircle2, Loader2,
  GraduationCap, Eye, MessageSquare, HelpCircle, Sparkles, AlertTriangle,
  FileImage, X, Download, GitBranch, Flag, ExternalLink,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MarkdownRenderer } from "@/components/content/markdown-renderer";
import { ContentViewToggle } from "@/components/content/content-view-toggle";
import { VisualCardsButton } from "@/components/explainer/VisualCardsButton";
import { HelpHint } from "@/components/explainer/HelpHint";
import {
  JobStatusCard,
  type ActiveJob,
} from "@/components/coverage/job-status-card";
import {
  SourcePreviewChip,
  type SourcePreview,
} from "@/components/coverage/source-preview-chip";
import { useBoardSelection } from "@/hooks/use-board-selection";
import { useData } from "@/hooks/use-data";
import { getBoards, getStandards, getSubjects, getTopicWithContent } from "@/lib/data";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Topic {
  id: number;
  title: string;
  description: string | null;
}

interface Chapter {
  id: number;
  chapterNumber: number;
  title: string;
  topics: Topic[];
}

interface Subject {
  id: number;
  name: string;
  code: string;
  isElective: boolean;
  chapters: Chapter[];
}

// ---------------------------------------------------------------------------
// Placeholder-title fallbacks
//
// When the NCERT downloader queues a subject before chapter PDFs are parsed,
// it seeds chapters + topics with placeholder names like:
//   chapter.title = "Mathematics — Chapter 1"
//   topic.title   = "Chapter 1 Content"
// Those placeholders leak through to the TOC when content generation stalls
// or when Fill Gaps ran against a subject that was never Bootstrap'd. Rather
// than showing the raw placeholder, we substitute a cleaner label — the
// actual chapter title if it's meaningful, otherwise a "Chapter N" stub —
// so students still see a coherent hierarchy while admins work the Coverage
// ops to backfill real titles. The regexes are tight so real titles like
// "Chapter 1: Real Numbers" are not rewritten.
// ---------------------------------------------------------------------------
const PLACEHOLDER_TOPIC_TITLE = /^Chapter \d+ Content$/i;
const PLACEHOLDER_CHAPTER_TITLE = /[—-]\s*Chapter\s*\d+\s*$/i;

function displayChapterTitle(ch: { chapterNumber: number; title: string }) {
  if (PLACEHOLDER_CHAPTER_TITLE.test(ch.title)) {
    return `Chapter ${ch.chapterNumber}`;
  }
  return ch.title;
}

function displayTopicTitle(
  topic: { title: string },
  chapter: { chapterNumber: number; title: string },
) {
  if (PLACEHOLDER_TOPIC_TITLE.test(topic.title)) {
    // The topic is just a chapter-wide "dump" row. Re-label it using the
    // chapter title so the sidebar doesn't repeat "Chapter N Content" for
    // every row in the tree.
    return displayChapterTitle(chapter);
  }
  return topic.title;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SyllabusExplorer({ userRole = "student" }: { userRole?: string }) {
  const isAdmin = userRole === "admin";
  const isTeacher = userRole === "teacher";
  const canSwitchBoard = isAdmin || isTeacher;
  const globalSelection = useBoardSelection();

  // Local board/grade/academic-year override for this page (admin/teacher can
  // freely switch; students get the global selection by default).
  const [localBoardId, setLocalBoardId] = useState<number | null>(null);
  const [localGrade, setLocalGrade] = useState<number | null>(null);
  // null means "auto" — resolve to the newest session that has rows for the
  // current board+grade. Setting it explicitly pins the view to one session
  // so students can still read last year's syllabus after the rollover.
  const [academicYearFilter, setAcademicYearFilter] = useState<string | null>(null);

  // Effective values: local override > global
  const boardId = localBoardId ?? globalSelection.boardId;
  const boardName = localBoardId
    ? null // will be resolved from boards data
    : globalSelection.boardName;
  const grade = localGrade ?? globalSelection.grade;

  // Fetch all boards for the selector
  const { data: allBoards } = useData(() => getBoards(), []);
  // Fetch grades/standards for selected board
  const { data: boardStandards } = useData(
    () => (boardId ? getStandards(boardId) : Promise.resolve([])),
    [boardId]
  );
  const searchParams = useSearchParams();
  const preSelectedSubjectId = searchParams.get("subjectId");

  const [selectedSubjectId, setSelectedSubjectId] = useState<number | null>(
    preSelectedSubjectId ? Number(preSelectedSubjectId) : null,
  );
  const [selectedTopicId, setSelectedTopicId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedChapters, setExpandedChapters] = useState<Set<number>>(new Set());
  const [topicContent, setTopicContent] = useState<{
    topic: { id: number; title: string; description: string | null; estimatedMinutes: number | null; chapter: { chapterNumber: number; title: string }; subject: { name: string } };
    contentItems: Array<{ id: number; title: string; body: string | null; contentType: string; sourceType: string; qualityScore: string | null; language?: string }>;
  } | null>(null);
  const [contentLoading, setContentLoading] = useState(false);
  const [pdfPopupPath, setPdfPopupPath] = useState<string | null>(null);
  // "View Complete Syllabus" popup — shows the official board-level syllabus
  // PDF (e.g. CBSE's Maths_SecP1X_2026-27.pdf) for the currently-selected
  // subject. Resolved lazily via /api/syllabus/source-pdf so we don't fire
  // the request until the student actually clicks the button.
  const [syllabusPdf, setSyllabusPdf] = useState<{
    found: boolean;
    pdfUrl?: string;
    filename?: string;
    sourceUrl?: string;
    resolvedVia: "metadata" | "filesystem" | "none";
  } | null>(null);
  const [syllabusPdfLoading, setSyllabusPdfLoading] = useState(false);
  const [syllabusPdfOpen, setSyllabusPdfOpen] = useState(false);
  // Foundation popup state
  const [foundationLoading, setFoundationLoading] = useState(false);
  const [foundationContent, setFoundationContent] = useState<{ title: string; body: string; cached: boolean; prerequisiteCount: number } | null>(null);
  const [foundationOpen, setFoundationOpen] = useState(false);
  const [gapInfo, setGapInfo] = useState<{ totalTopics: number; topicsMissing: number; estimatedCostUsd: number } | null>(null);
  const [filling, setFilling] = useState(false);
  const [fillResult, setFillResult] = useState<{ processed: number; totalCostUsd: number; errors: string[] } | null>(null);

  // Coverage ops — the canonical Bootstrap NCERT → Fan-out → Auto-publish flow
  // (mirrors /admin/coverage). Fill Gaps is kept below as a legacy fallback
  // but this is now the primary path: it pulls the real NCERT PDF, extracts
  // chapter titles, fans content out to topics, and publishes it — which is
  // why `metadata.pdfPath` / `sourceUrl` end up populated and the "Source PDF"
  // button appears. Fill Gaps only AI-generates text from topic titles and
  // leaves the book-source fields null, so students never get the PDF view.
  const [coverageAction, setCoverageAction] = useState<
    "bootstrap" | "fanout" | "autopublish" | "finalize" | null
  >(null);
  const [coverageBanner, setCoverageBanner] = useState<{
    kind: "ok" | "warn" | "err";
    text: string;
    next?: string;
  } | null>(null);

  // Live Bootstrap job (if one is queued or already running for this subject)
  // — matches the /admin/coverage experience so admins see real-time progress
  // + a final outcome line instead of having to jump to /scrape-jobs.
  const [activeJob, setActiveJob] = useState<ActiveJob | null>(null);

  // Dual-source availability preview: whether NCERT has a book for this
  // subject AND whether a CBSE textbook PDF has been scraped+parsed. Drives
  // the SourcePreviewChip above the Coverage ops bar and lets admins tell
  // at a glance why Bootstrap might be a no-op (e.g. skill subjects with no
  // NCERT entry).
  const [sourcePreview, setSourcePreview] = useState<SourcePreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  // Topic-level progress for the selected subject
  const [topicProgress, setTopicProgress] = useState<Record<number, { percent: number; understanding: string | null }>>({});
  // Per-subject progress summary (for the dropdown)
  const [subjectProgressMap, setSubjectProgressMap] = useState<Record<number, number>>({});

  const { data: subjects, loading: subjectsLoading } = useData(
    () =>
      boardId && grade
        ? getSubjects(boardId, grade, null, academicYearFilter)
        : Promise.resolve([]),
    [boardId, grade, academicYearFilter],
  );

  const subjectData = selectedSubjectId
    ? (subjects ?? []).find((s: Subject) => s.id === selectedSubjectId) ?? null
    : null;

  // Auto-select first subject if none selected
  useEffect(() => {
    if (!selectedSubjectId && subjects && subjects.length > 0) {
      setSelectedSubjectId(subjects[0].id);
    }
  }, [subjects, selectedSubjectId]);

  // Admins/teachers don't have a personal board/grade preference the way
  // students do — they're content curators. Seed the pickers to CBSE + 10
  // (our canonical, most-covered scope) so the page opens to something
  // useful instead of an empty-state dead end.
  useEffect(() => {
    if (!canSwitchBoard) return;
    if (localBoardId || globalSelection.boardId) return;
    if (!allBoards || allBoards.length === 0) return;
    const pick =
      (allBoards as Array<{ id: number; code: string; isActive: boolean }>)
        .find((b) => b.isActive && b.code === "CBSE") ??
      (allBoards as Array<{ id: number; code: string; isActive: boolean }>)
        .find((b) => b.isActive);
    if (pick) setLocalBoardId(pick.id);
  }, [canSwitchBoard, localBoardId, globalSelection.boardId, allBoards]);

  useEffect(() => {
    if (!canSwitchBoard) return;
    if (localGrade || globalSelection.grade) return;
    if (!boardStandards || boardStandards.length === 0) return;
    const grades = Array.from(
      new Set(
        (boardStandards as Array<{ grade: number }>).map((s) => s.grade)
      )
    ).sort((a, b) => a - b);
    // Grade 10 is our canonical demo scope; fall back to the lowest available.
    const pick = grades.includes(10) ? 10 : grades[0];
    if (pick != null) setLocalGrade(pick);
  }, [canSwitchBoard, localGrade, globalSelection.grade, boardStandards]);

  // Fetch topic progress when subject changes
  useEffect(() => {
    if (!selectedSubjectId) return;
    fetch(`/api/learn/progress?subjectId=${selectedSubjectId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (json?.success) setTopicProgress(json.data.topics ?? {});
      })
      .catch(() => {});
  }, [selectedSubjectId]);

  // Fetch progress summaries for all subjects (for dropdown color coding)
  useEffect(() => {
    if (!subjects || subjects.length === 0) return;
    const map: Record<number, number> = {};
    let completed = 0;
    const total = subjects.length;

    for (const s of subjects as Subject[]) {
      fetch(`/api/learn/progress?subjectId=${s.id}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((json) => {
          if (json?.success) {
            const topics = json.data.topics as Record<string, { percent: number }>;
            const ids = Object.keys(topics);
            const avg = ids.length > 0
              ? Math.round(ids.reduce((sum, id) => sum + topics[id].percent, 0) / ids.length)
              : 0;
            map[s.id] = avg;
          }
          completed++;
          if (completed >= total) setSubjectProgressMap({ ...map });
        })
        .catch(() => { completed++; });
    }
  }, [subjects]);

  // Fetch content gap info for selected subject (admin only)
  useEffect(() => {
    if (!selectedSubjectId) return;
    setGapInfo(null);
    setFillResult(null);
    fetch(`/api/admin/content/fill-gaps?subjectId=${selectedSubjectId}`)
      .then((r) => r.json())
      .then((json) => { if (json.success) setGapInfo(json.data); })
      .catch(() => {});
  }, [selectedSubjectId]);

  // Reset the resolved syllabus PDF whenever the subject changes — the old
  // one belongs to the previous subject. We don't pre-fetch here; the
  // resolution fires lazily from the "View Complete Syllabus" click so we
  // don't spam the API for students who never open the popup.
  useEffect(() => {
    setSyllabusPdf(null);
    setSyllabusPdfOpen(false);
  }, [selectedSubjectId, academicYearFilter]);

  const openSyllabusPdf = useCallback(async () => {
    if (!selectedSubjectId) return;
    setSyllabusPdfOpen(true);
    // Re-use the last resolution if we already have it for this subject.
    if (syllabusPdf) return;
    setSyllabusPdfLoading(true);
    try {
      const res = await fetch(
        `/api/syllabus/source-pdf?subjectId=${selectedSubjectId}`,
      );
      const json = await res.json();
      if (json.success) {
        setSyllabusPdf(json.data);
      } else {
        setSyllabusPdf({ found: false, resolvedVia: "none" });
      }
    } catch {
      setSyllabusPdf({ found: false, resolvedVia: "none" });
    } finally {
      setSyllabusPdfLoading(false);
    }
  }, [selectedSubjectId, syllabusPdf]);

  // Expand all chapters when a subject is selected
  useEffect(() => {
    if (subjectData) {
      setExpandedChapters(new Set(subjectData.chapters.map((c: Chapter) => c.id)));
    }
  }, [subjectData]);

  // Filter chapters/topics by search
  const filteredChapters = useMemo(() => {
    if (!subjectData?.chapters) return [];
    if (!searchQuery.trim()) return subjectData.chapters;

    const q = searchQuery.toLowerCase();
    return subjectData.chapters
      .map((ch: Chapter) => ({
        ...ch,
        topics: ch.topics.filter(
          (t: Topic) =>
            t.title.toLowerCase().includes(q) ||
            (t.description ?? "").toLowerCase().includes(q) ||
            ch.title.toLowerCase().includes(q),
        ),
      }))
      .filter((ch: Chapter) => ch.topics.length > 0 || ch.title.toLowerCase().includes(q));
  }, [subjectData, searchQuery]);

  // Flatten all topics for navigation
  const allTopics = useMemo(() => {
    if (!subjectData) return [];
    return subjectData.chapters.flatMap((ch: Chapter) =>
      ch.topics.map((t: Topic) => ({ ...t, chapterNumber: ch.chapterNumber, chapterTitle: ch.title }))
    );
  }, [subjectData]);

  // Sessions available for the current board+grade, newest first. We derive
  // this from /api/boards/:id/standards rather than hard-coding
  // SELECTABLE_ACADEMIC_YEARS, so the dropdown only offers sessions that
  // actually have subject rows — no empty years showing up for CBSE Class 1
  // (where we've only ever scraped 2026-27) or the reverse.
  const availableAcademicYears = useMemo<string[]>(() => {
    if (!grade || !boardStandards) return [];
    const years = (boardStandards as Array<{ grade: number; academicYear: string }>)
      .filter((s) => s.grade === grade)
      .map((s) => s.academicYear);
    return Array.from(new Set(years)).sort().reverse();
  }, [grade, boardStandards]);

  // Resolve the session this board+grade pair is being viewed in. When the
  // user explicitly pins a year, that wins; otherwise we default to the
  // newest available. Shown in the top-bar info chip so students can tell at
  // a glance which session's content they're reading — lexicographic sort on
  // "YYYY-YY" works because the leading 4 digits make comparisons
  // chronological.
  const activeAcademicYear = useMemo<string | null>(() => {
    if (academicYearFilter) return academicYearFilter;
    return availableAcademicYears[0] ?? null;
  }, [academicYearFilter, availableAcademicYears]);

  // The Coverage run endpoint keys on the board *code* (e.g. "CBSE"), not the
  // numeric ID, because historically the admin flows were code-first. Rather
  // than change the route, we resolve the code from `allBoards` here.
  const selectedBoardCode = useMemo<string | null>(() => {
    if (!boardId || !allBoards) return null;
    const b = (allBoards as Array<{ id: number; code: string }>).find(
      (x) => x.id === boardId,
    );
    return b?.code ?? null;
  }, [boardId, allBoards]);

  const currentTopicIndex = selectedTopicId ? allTopics.findIndex((t) => t.id === selectedTopicId) : -1;

  // Load topic content when selected
  const loadTopicContent = useCallback(async (topicId: number) => {
    setSelectedTopicId(topicId);
    setContentLoading(true);
    try {
      const data = await getTopicWithContent(topicId);
      setTopicContent(data);
    } catch {
      setTopicContent(null);
    } finally {
      setContentLoading(false);
    }
  }, []);

  // Foundation builder
  async function handleBuildFoundations() {
    if (!selectedTopicId) return;
    setFoundationLoading(true);
    try {
      // Check for existing
      const checkRes = await fetch(`/api/learn/foundations?topicId=${selectedTopicId}`);
      const checkJson = await checkRes.json();
      if (checkJson.success && checkJson.data) {
        setFoundationContent({ title: checkJson.data.title, body: checkJson.data.body, cached: true, prerequisiteCount: 0 });
        setFoundationOpen(true);
        setFoundationLoading(false);
        return;
      }
      // Generate
      const res = await fetch("/api/learn/foundations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topicId: selectedTopicId }),
      });
      const json = await res.json();
      if (json.success) {
        setFoundationContent({ title: json.data.title, body: json.data.body, cached: json.data.cached, prerequisiteCount: json.data.prerequisiteCount });
        setFoundationOpen(true);
      }
    } catch (err) {
      console.error("Foundation build failed:", err);
    } finally {
      setFoundationLoading(false);
    }
  }

  // Coverage ops — the canonical content-generation flow mirrored from
  // /admin/coverage. Posts to /api/admin/coverage/run with the same payload
  // shape ({ action, board, grade, subjectId }) and shows a banner describing
  // the result + next-step hint, identical to the admin page so an admin
  // moving between the two pages sees consistent feedback.
  //
  // Why this matters: Bootstrap NCERT is what populates `metadata.pdfPath`
  // and `sourceUrl` on content_items — the fields that make the "Source PDF"
  // button appear. Fill Gaps (below) only AI-generates text and leaves those
  // fields null, which is why 2026-27 Mathematics currently shows no PDF
  // button even though content is "present".
  const runCoverageAction = useCallback(
    async (action: "bootstrap" | "fanout" | "autopublish" | "finalize") => {
      if (!selectedBoardCode || !grade || !selectedSubjectId) return;
      setCoverageAction(action);
      setCoverageBanner(null);
      try {
        const res = await fetch("/api/admin/coverage/run", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action,
            board: selectedBoardCode,
            grade,
            subjectId: selectedSubjectId,
            // Critical: without this the server falls back to
            // DEFAULT_ACADEMIC_YEAR and Bootstrap writes into the wrong
            // standards row, so an admin pinned to 2026-27 would still
            // see rows land under 2025-26. `activeAcademicYear` resolves
            // to either the explicit pin or the newest session for the
            // current board+grade (see the useMemo above).
            academicYear: activeAcademicYear ?? undefined,
          }),
        });
        const json = await res.json();
        if (!json.success) throw new Error(json.error?.message ?? "Action failed");
        const d = json.data;

        if (action === "bootstrap") {
          const isRunning = d.status === "already_running";
          const subjectLabel =
            (subjects as Subject[] | undefined)?.find(
              (s) => s.id === selectedSubjectId,
            )?.name ?? "subject";
          setCoverageBanner({
            kind: "ok",
            text: isRunning
              ? `Bootstrap already in progress (Job #${d.jobId}).`
              : `Bootstrap queued — Job #${d.jobId}. ${
                  sourcePreview?.ncert.available
                    ? `Will download ${sourcePreview.ncert.books.length} NCERT book(s), ${sourcePreview.ncert.totalChapters} chapter(s).`
                    : "Worker will download NCERT PDFs and extract real chapter/topic titles."
                }`,
            next:
              "Progress appears below; no need to leave this page. Once the job finishes, run Fan-out + Auto-publish (or just Finalize).",
          });
          // Start the live poll — initial state mirrors what /admin/coverage
          // sets, so the JobStatusCard renders identically here.
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
            displayLabel: `Bootstrap NCERT — ${selectedBoardCode} · Grade ${grade} · ${subjectLabel}`,
          });
        } else if (action === "fanout") {
          const cloned = Number(d.topicsCloned ?? 0);
          const handled = Number(d.chaptersHandled ?? 0);
          const skipped = Number(d.chaptersSkippedNoSource ?? 0);
          let next: string | undefined;
          if (cloned === 0 && skipped > 0) {
            next = "No chapter has parsed source content yet. Run Bootstrap NCERT first.";
          } else if (cloned === 0 && handled === 0) {
            next = "Every topic already has content — nothing to fan out. Run Auto-publish to flip high-quality rows to visible.";
          } else if (skipped > 0) {
            next = `${skipped} chapter(s) had no source row. Run Bootstrap to fetch them, then re-run Fan-out.`;
          } else {
            next = "Next: run Auto-publish to make the newly-cloned content visible to students.";
          }
          setCoverageBanner({
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
            next = "Done. Reload the page to see the newly-published topics in the tree.";
          }
          setCoverageBanner({
            kind: updated > 0 ? "ok" : "warn",
            text: `Auto-publish: ${updated} row(s) flipped to published/auto_approved (of ${candidates} candidate(s)).`,
            next,
          });
        } else if (action === "finalize") {
          const cloned = Number(d.summary?.topicsCloned ?? 0);
          const published = Number(d.summary?.rowsPublished ?? 0);
          const skipped = Number(d.summary?.chaptersSkippedNoSource ?? 0);
          setCoverageBanner({
            kind: published > 0 || cloned > 0 ? "ok" : "warn",
            text: `Finalize: cloned ${cloned} topic(s), published ${published} row(s)${skipped > 0 ? `, ${skipped} chapter(s) skipped (no source)` : ""}.`,
            next:
              skipped > 0
                ? "Run Bootstrap NCERT to fetch the missing chapters, then re-run Finalize."
                : "Reload the page to see the updated tree.",
          });
        }

        // Refresh gap info so the legacy Fill Gaps affordance updates too.
        const gapRes = await fetch(
          `/api/admin/content/fill-gaps?subjectId=${selectedSubjectId}`,
        );
        const gapJson = await gapRes.json();
        if (gapJson.success) setGapInfo(gapJson.data);
      } catch (e) {
        setCoverageBanner({
          kind: "err",
          text: e instanceof Error ? e.message : "Network error",
        });
      } finally {
        setCoverageAction(null);
      }
    },
    [selectedBoardCode, grade, selectedSubjectId, subjects, sourcePreview, activeAcademicYear],
  );

  // --------------------------------------------------------------------
  // Pre-flight: dual-source availability check. Fires on every subject
  // change (admin only — students don't need this context). Mirrors the
  // /admin/coverage page so the same recommendation surfaces here.
  // --------------------------------------------------------------------
  useEffect(() => {
    if (!isAdmin || !grade || !selectedSubjectId) {
      setSourcePreview(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoadingPreview(true);
      try {
        const qs = new URLSearchParams({
          grade: String(grade),
          subjectId: String(selectedSubjectId),
        });
        // Thread the pinned year through so the recommendation reads e.g.
        // "Grade 10 (2026-27)" and we don't show 2025-26 advice when the
        // user has explicitly asked for 2026-27.
        if (activeAcademicYear) qs.set("academicYear", activeAcademicYear);
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
  }, [isAdmin, grade, selectedSubjectId, activeAcademicYear]);

  // --------------------------------------------------------------------
  // Restore any in-flight background job for the current subject on mount
  // / subject change. Without this the JobStatusCard vanishes on every
  // page reload even while a cbse_content_fill or subject-scoped
  // ncert_download is still running in Redis. Queries
  // /api/admin/scrape-jobs?status=queued,running&subjectId=… and rehydrates
  // activeJob from whichever latest row matches. Only populates when there
  // isn't a live job already being tracked (so we don't clobber one the
  // user just clicked).
  // --------------------------------------------------------------------
  useEffect(() => {
    if (!isAdmin || !selectedBoardCode || !grade || !selectedSubjectId) return;
    if (
      activeJob &&
      activeJob.status !== "completed" &&
      activeJob.status !== "failed" &&
      activeJob.status !== "cancelled"
    ) {
      return; // Already tracking something live — don't overwrite.
    }
    let cancelled = false;
    (async () => {
      try {
        const qs = new URLSearchParams({
          status: "queued,running",
          jobType: "cbse_content_fill,ncert_download",
          subjectId: String(selectedSubjectId),
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
        const subjectLabel =
          (subjects as Subject[] | undefined)?.find(
            (s) => s.id === selectedSubjectId,
          )?.name ?? "subject";
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
          displayLabel: `${labelPrefix} — ${selectedBoardCode} · Grade ${grade} · ${subjectLabel}`,
        });
      } catch {
        // Best-effort — if the lookup fails the admin can refresh the page.
      }
    })();
    return () => {
      cancelled = true;
    };
    // activeJob intentionally excluded from deps: only re-run on subject
    // change, not every time the polling loop mutates activeJob.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, selectedBoardCode, grade, selectedSubjectId, subjects]);

  // --------------------------------------------------------------------
  // Poll the active job every 3s so the JobStatusCard shows live progress
  // + final result without forcing the admin to jump to /scrape-jobs.
  // Stops once the job settles. When it completes, also refresh the gap
  // info so the Coverage ops bar re-renders against fresh counts.
  // --------------------------------------------------------------------
  useEffect(() => {
    if (!activeJob) return;
    if (
      activeJob.status === "completed" ||
      activeJob.status === "failed" ||
      activeJob.status === "cancelled"
    ) {
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
        if (
          row.status === "completed" ||
          row.status === "failed" ||
          row.status === "cancelled"
        ) {
          // Refresh gap info + source preview — the worker may have produced
          // new rows that change the Coverage ops bar's affordances.
          if (selectedSubjectId) {
            fetch(`/api/admin/content/fill-gaps?subjectId=${selectedSubjectId}`)
              .then((r) => r.json())
              .then((j) => {
                if (j.success) setGapInfo(j.data);
              })
              .catch(() => {});
          }
        }
      } catch {
        // Transient — will retry on next tick.
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [activeJob, selectedSubjectId]);

  // Navigation functions
  async function fillGaps() {
    if (!selectedSubjectId || filling) return;
    setFilling(true);
    setFillResult(null);
    try {
      const res = await fetch("/api/admin/content/fill-gaps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subjectId: selectedSubjectId, notes: true, limit: 50 }),
      });
      const json = await res.json();
      if (json.success) {
        setFillResult(json.data);
        // Refresh gap info
        const gapRes = await fetch(`/api/admin/content/fill-gaps?subjectId=${selectedSubjectId}`);
        const gapJson = await gapRes.json();
        if (gapJson.success) setGapInfo(gapJson.data);
      }
    } catch { /* silent */ } finally {
      setFilling(false);
    }
  }

  function goFirst() { if (allTopics.length > 0) loadTopicContent(allTopics[0].id); }
  function goPrev() { if (currentTopicIndex > 0) loadTopicContent(allTopics[currentTopicIndex - 1].id); }
  function goNext() { if (currentTopicIndex < allTopics.length - 1) loadTopicContent(allTopics[currentTopicIndex + 1].id); }
  function goLast() { if (allTopics.length > 0) loadTopicContent(allTopics[allTopics.length - 1].id); }

  function toggleChapter(chapterId: number) {
    setExpandedChapters((prev) => {
      const next = new Set(prev);
      if (next.has(chapterId)) next.delete(chapterId);
      else next.add(chapterId);
      return next;
    });
  }

  // No board selected — students must pick one from their dashboard first.
  // Admins/teachers don't hit this: the auto-seed effects above pick CBSE/10,
  // and they can switch freely via the top-bar selectors.
  if ((!boardId || !grade) && !canSwitchBoard) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <BookOpen className="h-12 w-12 text-muted-foreground/50 mb-4" />
        <h2 className="text-lg font-semibold">No board selected</h2>
        <p className="text-sm text-muted-foreground mt-1">Go to the dashboard and select your board & class.</p>
        <Button asChild className="mt-4"><Link href="/dashboard">Go to Dashboard</Link></Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] -mx-4 lg:-mx-6 -my-4 lg:-my-6">
      {/* Top Bar — board/grade + search + filters + navigation */}
      <div className="flex items-center gap-2 border-b px-4 py-2 shrink-0 bg-card flex-wrap">
        {/* Board selector */}
        <Select
          value={boardId?.toString() ?? ""}
          onValueChange={(v) => {
            setLocalBoardId(Number(v));
            setLocalGrade(null);
            // Reset the year pin when the board changes — the new board may
            // not have the same sessions available, and holding onto a stale
            // value would send an invalid academicYear to the API.
            setAcademicYearFilter(null);
            setSelectedSubjectId(null);
            setSelectedTopicId(null);
            setTopicContent(null);
          }}
          disabled={!canSwitchBoard}
        >
          <SelectTrigger className="h-8 w-[130px] text-xs">
            <SelectValue placeholder="Board" />
          </SelectTrigger>
          <SelectContent>
            {(allBoards ?? []).filter((b: { isActive: boolean }) => b.isActive).map((b: { id: number; code: string; name: string }) => (
              <SelectItem key={b.id} value={b.id.toString()} className="text-xs">{b.code}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Grade selector */}
        <Select
          value={grade?.toString() ?? ""}
          onValueChange={(v) => {
            setLocalGrade(Number(v));
            // Same reasoning as the board-change reset — a Class 1 pin to
            // 2024-25 shouldn't survive a switch to Class 10.
            setAcademicYearFilter(null);
            setSelectedSubjectId(null);
            setSelectedTopicId(null);
            setTopicContent(null);
          }}
        >
          <SelectTrigger className="h-8 w-[110px] text-xs">
            <SelectValue placeholder="Class" />
          </SelectTrigger>
          <SelectContent>
            {(boardStandards ?? [])
              .map((s: { grade: number }) => s.grade)
              .filter((g: number, i: number, arr: number[]) => arr.indexOf(g) === i)
              .sort((a: number, b: number) => a - b)
              .map((g: number) => (
                <SelectItem key={g} value={g.toString()} className="text-xs">Class {g}</SelectItem>
              ))}
          </SelectContent>
        </Select>

        {/* Academic-year selector — only rendered when the current board+grade
            actually has multiple sessions, so students on a board that's only
            been scraped for one year don't see a redundant dropdown. "Auto"
            falls back to the newest available session. */}
        {availableAcademicYears.length > 0 && (
          <Select
            value={academicYearFilter ?? "auto"}
            onValueChange={(v) => {
              setAcademicYearFilter(v === "auto" ? null : v);
              setSelectedSubjectId(null);
              setSelectedTopicId(null);
              setTopicContent(null);
            }}
          >
            <SelectTrigger className="h-8 w-[130px] text-xs">
              <SelectValue placeholder="Session" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto" className="text-xs">
                Auto ({availableAcademicYears[0]})
              </SelectItem>
              {availableAcademicYears.map((y) => (
                <SelectItem key={y} value={y} className="text-xs">
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <Separator orientation="vertical" className="h-5" />

        {/* Subject selector with progress */}
        <Select value={selectedSubjectId?.toString() ?? ""} onValueChange={(v) => { setSelectedSubjectId(Number(v)); setSelectedTopicId(null); setTopicContent(null); setSearchQuery(""); setTopicProgress({}); }}>
          <SelectTrigger className="h-8 w-[240px] text-xs"><SelectValue placeholder="Select Subject" /></SelectTrigger>
          <SelectContent>
            {(subjects ?? []).map((s: Subject) => {
              const pct = subjectProgressMap[s.id] ?? 0;
              const dotColor = pct >= 80 ? "bg-emerald-500" : pct >= 40 ? "bg-amber-500" : pct > 0 ? "bg-blue-500" : "bg-gray-300";
              return (
                <SelectItem key={s.id} value={s.id.toString()}>
                  <span className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full shrink-0 ${dotColor}`} />
                    <span>{s.name} ({s.chapters.length} ch)</span>
                    {pct > 0 && <span className="text-[10px] text-muted-foreground tabular-nums">{pct}%</span>}
                  </span>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>

        <Separator orientation="vertical" className="h-5" />

        {/* Search */}
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
          <Input placeholder="Search chapters & topics..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="h-8 pl-8 text-xs" />
        </div>

        {/* View Complete Syllabus — opens the original board-level curriculum
            PDF (e.g. CBSE's Maths_SecP1X_2026-27.pdf) for the selected
            subject, resolved via /api/syllabus/source-pdf. Only shown once a
            subject is picked; the feature is subject-scoped, not topic-
            scoped, so we don't wait for a topic selection. */}
        {selectedSubjectId && (
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs gap-1.5 border-violet-200 text-violet-700 hover:bg-violet-50 hover:text-violet-800 dark:border-violet-900/50 dark:text-violet-300 dark:hover:bg-violet-900/20"
            onClick={openSyllabusPdf}
            title="View the official curriculum document from the board"
          >
            <BookOpen className="h-3.5 w-3.5" />
            <span className="hidden md:inline">View Complete Syllabus</span>
            <span className="md:hidden">Syllabus</span>
          </Button>
        )}

        <div className="flex-1" />

        {/* Navigation buttons */}
        {selectedTopicId && (
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-muted-foreground mr-1">
              {currentTopicIndex + 1}/{allTopics.length}
            </span>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={goFirst} disabled={currentTopicIndex <= 0} title="First"><ChevronsLeft className="h-3.5 w-3.5" /></Button>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={goPrev} disabled={currentTopicIndex <= 0} title="Previous"><ChevronLeft className="h-3.5 w-3.5" /></Button>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={goNext} disabled={currentTopicIndex >= allTopics.length - 1} title="Next"><ChevronRight className="h-3.5 w-3.5" /></Button>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={goLast} disabled={currentTopicIndex >= allTopics.length - 1} title="Last"><ChevronsRight className="h-3.5 w-3.5" /></Button>
          </div>
        )}

        <Separator orientation="vertical" className="h-5" />

        {/* Info — board · class · session. Academic year appears last so the
            eye reads it as the "qualifier" for the class above, not as a
            separate filter. Hidden on narrow screens to keep the top bar
            scannable on tablets. */}
        {boardId && grade ? (
          <span className="text-[10px] text-muted-foreground hidden sm:inline">
            {boardName ?? ""}{boardName ? " · " : ""}Class {grade}
            {activeAcademicYear ? ` · ${activeAcademicYear}` : ""}
          </span>
        ) : null}

        {/* Open in Learn view */}
        {selectedTopicId && (
          <>
            <VisualCardsButton topicId={selectedTopicId} variant="ghost" />
            <Link href={`/dashboard/learn/${selectedTopicId}`}>
              <Button variant="ghost" size="sm" className="h-7 text-xs">
                <GraduationCap className="mr-1 h-3 w-3" /> Playground
              </Button>
            </Link>
          </>
        )}

      </div>

      {/* =================================================================
          Admin Coverage Ops Bar
          ------------------------------------------------------------------
          Only admins see this. It's the canonical content-generation path:
          Bootstrap NCERT → Fan-out → Auto-publish (or Finalize = last two
          in one click). This is what Populates metadata.pdfPath / sourceUrl
          on content_items so the "Source PDF" button shows on the reading
          view. Fill Gaps (below, demoted) is kept as a legacy AI-only
          fallback, but it's not the recommended path any more — hence the
          "Legacy:" prefix and ghost styling.
          ================================================================= */}
      {isAdmin && selectedSubjectId && (
        <div className="flex items-center gap-2 border-b bg-muted/30 px-4 py-1.5 shrink-0 flex-wrap">
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Coverage ops
          </span>

          <Button
            variant="default"
            size="sm"
            className="h-7 bg-violet-600 hover:bg-violet-700 text-xs"
            onClick={() => runCoverageAction("bootstrap")}
            disabled={coverageAction !== null || !selectedBoardCode}
            title="Queue an NCERT download job — fetches real PDFs + extracts real chapter/topic titles"
          >
            {coverageAction === "bootstrap" ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <Download className="mr-1 h-3 w-3" />
            )}
            Bootstrap NCERT
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => runCoverageAction("fanout")}
            disabled={coverageAction !== null || !selectedBoardCode}
            title="Clone chapter-level source content into each topic under the chapter"
          >
            {coverageAction === "fanout" ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <GitBranch className="mr-1 h-3 w-3" />
            )}
            Fan-out
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => runCoverageAction("autopublish")}
            disabled={coverageAction !== null || !selectedBoardCode}
            title="Flip high-quality (≥0.7) review_status rows to published/auto_approved"
          >
            {coverageAction === "autopublish" ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <CheckCircle2 className="mr-1 h-3 w-3" />
            )}
            Auto-publish
          </Button>

          <Button
            variant="secondary"
            size="sm"
            className="h-7 text-xs"
            onClick={() => runCoverageAction("finalize")}
            disabled={coverageAction !== null || !selectedBoardCode}
            title="Run Fan-out then Auto-publish in one call"
          >
            {coverageAction === "finalize" ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <Flag className="mr-1 h-3 w-3" />
            )}
            Finalize
          </Button>

          <span className="text-[10px] text-muted-foreground ml-1 hidden md:inline">
            Bootstrap → Fan-out → Auto-publish, or just Finalize.
          </span>

          <div className="flex-1" />

          {/* Gap indicator (surfaces whether content is missing at all). */}
          {gapInfo && gapInfo.topicsMissing > 0 && (
            <span className="text-[10px] text-amber-600 flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              {gapInfo.topicsMissing}/{gapInfo.totalTopics} topics missing
            </span>
          )}
          {gapInfo && gapInfo.topicsMissing === 0 && (
            <span className="text-[10px] text-emerald-600 flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3" /> All {gapInfo.totalTopics} topics covered
            </span>
          )}

          {/* Demoted legacy button. Still here because Fill Gaps is the only
              way to backfill when NCERT has no book (e.g. board-specific
              electives), but the title + muted styling steers admins to the
              Coverage ops above by default. */}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-[10px] text-muted-foreground hover:text-foreground"
            onClick={fillGaps}
            disabled={filling || !gapInfo || gapInfo.topicsMissing === 0}
            title="Legacy: AI-generates text from topic titles only — no NCERT source, no Source PDF button. Use Coverage ops above when possible."
          >
            {filling ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <Sparkles className="mr-1 h-3 w-3" />
            )}
            Legacy: Fill Gaps
            {gapInfo && gapInfo.topicsMissing > 0
              ? ` (~$${gapInfo.estimatedCostUsd.toFixed(2)})`
              : ""}
          </Button>

          {fillResult && (
            <span className="text-[10px] text-emerald-600">
              Generated {fillResult.processed} topics
            </span>
          )}
        </div>
      )}

      {/* Coverage banner (admin ops result). Matches /admin/coverage styling
          so the feedback surface is consistent across pages. */}
      {coverageBanner && (
        <div className="px-4 pt-2 shrink-0">
          <div
            className={`flex items-start gap-3 rounded-md border p-3 text-sm ${
              coverageBanner.kind === "ok"
                ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-800 dark:text-emerald-300"
                : coverageBanner.kind === "warn"
                ? "border-amber-500/20 bg-amber-500/5 text-amber-800 dark:text-amber-300"
                : "border-rose-500/20 bg-rose-500/5 text-rose-800 dark:text-rose-300"
            }`}
          >
            {coverageBanner.kind === "ok" ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            ) : (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            )}
            <div className="flex-1">
              <div>{coverageBanner.text}</div>
              {coverageBanner.next && (
                <div className="mt-1 text-xs opacity-80">
                  <span className="font-medium">Next:</span> {coverageBanner.next}
                </div>
              )}
            </div>
            <button
              className="text-xs underline"
              onClick={() => setCoverageBanner(null)}
            >
              dismiss
            </button>
          </div>
        </div>
      )}

      {/* =================================================================
          Source-availability chip + live Bootstrap job card (admin only)
          ------------------------------------------------------------------
          Mirrors the /admin/coverage page exactly — the chip tells the admin
          whether NCERT has a book for this subject (and which recommendation
          to follow), and the job card polls /api/admin/scrape-jobs/{id}
          every 3s so progress + the final outcome appear inline without
          jumping to /scrape-jobs.
          ================================================================= */}
      {isAdmin && selectedSubjectId && (sourcePreview || loadingPreview || activeJob) && (
        <div className="px-4 pt-2 shrink-0 space-y-2">
          {loadingPreview && !sourcePreview && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Checking NCERT + CBSE textbook availability…
            </div>
          )}
          {sourcePreview && <SourcePreviewChip preview={sourcePreview} />}
          {activeJob && (
            <JobStatusCard job={activeJob} onDismiss={() => setActiveJob(null)} />
          )}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Left Panel — Syllabus Tree View */}
        <aside className="w-72 shrink-0 flex flex-col border-r bg-card hidden lg:flex">
          <ScrollArea className="flex-1">
            <div className="p-2">
              {subjectsLoading ? (
                <div className="space-y-2 p-2">
                  {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-6 w-full" />)}
                </div>
              ) : !subjectData ? (
                <div className="p-4 text-center text-xs text-muted-foreground">Select a subject</div>
              ) : (
                <div className="space-y-0.5">
                  {filteredChapters.map((chapter: Chapter) => {
                    const isExpanded = expandedChapters.has(chapter.id);
                    return (
                      <div key={chapter.id}>
                        {/* Chapter header */}
                        <button
                          onClick={() => toggleChapter(chapter.id)}
                          className="flex items-center gap-1.5 w-full rounded px-2 py-1.5 text-left text-xs font-medium hover:bg-muted/50 transition-colors"
                        >
                          {isExpanded ? <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" /> : <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />}
                          <span className="text-muted-foreground font-mono text-[10px] shrink-0">Ch {chapter.chapterNumber}</span>
                          <span className="truncate">{displayChapterTitle(chapter)}</span>
                          <span className="ml-auto text-[9px] text-muted-foreground shrink-0">{chapter.topics.length}</span>
                        </button>

                        {/* Topics */}
                        {isExpanded && (
                          <div className="ml-3 border-l pl-2 space-y-0.5">
                            {chapter.topics.map((topic: Topic) => {
                              const tp = topicProgress[topic.id];
                              const pct = tp?.percent ?? 0;
                              const und = tp?.understanding;
                              let dotColor = "bg-gray-300 dark:bg-gray-600";
                              if (und === "green") dotColor = "bg-emerald-500";
                              else if (und === "orange") dotColor = "bg-amber-500";
                              else if (und === "red") dotColor = "bg-red-500";
                              else if (pct >= 80) dotColor = "bg-emerald-500";
                              else if (pct >= 40) dotColor = "bg-amber-500";
                              else if (pct > 0) dotColor = "bg-blue-500";

                              return (
                                <button
                                  key={topic.id}
                                  onClick={() => loadTopicContent(topic.id)}
                                  className={`flex items-center gap-1.5 w-full rounded px-2 py-1 text-left text-[11px] transition-colors ${
                                    selectedTopicId === topic.id
                                      ? "bg-primary/10 text-primary font-medium"
                                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                                  }`}
                                >
                                  <span className={`h-2 w-2 rounded-full shrink-0 ${dotColor}`} title={pct > 0 ? `${pct}%` : "Not started"} />
                                  <span className="truncate flex-1">{displayTopicTitle(topic, chapter)}</span>
                                  {pct > 0 && <span className="text-[9px] tabular-nums text-muted-foreground/70 shrink-0">{pct}%</span>}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {filteredChapters.length === 0 && searchQuery && (
                    <div className="px-2 py-4 text-center text-xs text-muted-foreground">No matches for &quot;{searchQuery}&quot;</div>
                  )}
                </div>
              )}
            </div>
          </ScrollArea>

          {/* Subject stats footer */}
          {subjectData && (
            <div className="border-t px-3 py-2 text-[10px] text-muted-foreground shrink-0">
              {subjectData.chapters.length} chapters · {allTopics.length} topics
            </div>
          )}
        </aside>

        {/* Right Panel — Content */}
        <main className="flex-1 overflow-hidden">
          <ScrollArea className="h-full">
            {!selectedTopicId ? (
              /* No topic selected — show welcome */
              <div className="flex flex-col items-center justify-center h-full text-center px-4">
                <Layers className="h-12 w-12 text-muted-foreground/30 mb-4" />
                <h2 className="text-lg font-semibold">Select a topic</h2>
                <p className="text-sm text-muted-foreground mt-1 max-w-md">
                  Choose a topic from the syllabus tree on the left to view its content, or use the search bar to find specific topics.
                </p>
              </div>
            ) : contentLoading ? (
              <div className="flex items-center justify-center h-64">
                <Loader2 className="h-8 w-8 animate-spin text-violet-600" />
              </div>
            ) : topicContent ? (
              <div className="max-w-3xl mx-auto px-4 py-6 lg:px-8">
                {/* Topic header */}
                <div className="mb-4">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                    <span>{topicContent.topic.subject.name}</span>
                    <ChevronRight className="h-3 w-3" />
                    <span>Ch {topicContent.topic.chapter.chapterNumber}: {displayChapterTitle(topicContent.topic.chapter)}</span>
                  </div>
                  <h1 className="text-xl font-bold">{displayTopicTitle(topicContent.topic, topicContent.topic.chapter)}</h1>
                  {topicContent.topic.description && (
                    <p className="text-sm text-muted-foreground mt-1">{topicContent.topic.description}</p>
                  )}
                  <div className="flex items-center gap-2 mt-2">
                    {topicContent.topic.estimatedMinutes && (
                      <Badge variant="outline" className="text-[10px]">~{topicContent.topic.estimatedMinutes} min</Badge>
                    )}
                    <Badge variant="outline" className="text-[10px]">{topicContent.contentItems.length} content items</Badge>
                    <VisualCardsButton topicId={selectedTopicId} className="h-6 px-2 text-[10px]" showHelp />
                    <Link href={`/dashboard/learn/${selectedTopicId}`}>
                      <Badge variant="secondary" className="text-[10px] cursor-pointer hover:bg-primary/10">
                        <GraduationCap className="mr-0.5 h-3 w-3" /> Playground
                      </Badge>
                    </Link>
                    <span className="inline-flex items-center gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-6 text-[10px] gap-1"
                        disabled={foundationLoading}
                        onClick={handleBuildFoundations}
                      >
                        {foundationLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Layers className="h-3 w-3" />}
                        {foundationLoading ? "Building..." : "Build Foundations"}
                      </Button>
                      <HelpHint
                        title="Build Foundations"
                        summary="Quick recap of the prerequisite concepts for this topic"
                      >
                        <p>
                          Builds a short primer covering the earlier concepts you
                          need <em>before</em> this topic — useful when something
                          here assumes knowledge you haven&apos;t revised in a while.
                        </p>
                        <p>
                          Tap it and the AI checks this topic&apos;s prerequisites
                          and opens a recap. If a shared primer already exists it
                          appears instantly; otherwise it&apos;s generated once and
                          reused.
                        </p>
                      </HelpHint>
                    </span>
                  </div>
                </div>

                <Separator className="mb-4" />

                {/* Content items */}
                {topicContent.contentItems.length > 0 ? (
                  <div className="space-y-6">
                    {topicContent.contentItems.map((ci) => {
                      const meta = (ci as { metadata?: Record<string, unknown> }).metadata;
                      const pdfPath = meta?.pdfPath ?? meta?.extractedFrom;

                      return (
                        <div key={ci.id}>
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium">{ci.title}</span>
                              <Badge variant="secondary" className="text-[10px]">{ci.sourceType === "ai_generated" ? "AI" : ci.sourceType === "ncert" ? "NCERT" : ci.sourceType}</Badge>
                              {ci.qualityScore ? <Badge variant="outline" className="text-[10px]">{Math.round(parseFloat(ci.qualityScore) * 100)}%</Badge> : null}
                              {ci.language && ci.language !== "en" ? <Badge variant="outline" className="text-[10px]">{ci.language.toUpperCase()}</Badge> : null}
                            </div>
                            {pdfPath ? (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs shrink-0"
                                onClick={() => setPdfPopupPath(String(pdfPath))}
                              >
                                <FileImage className="mr-1 h-3 w-3" /> Source PDF
                              </Button>
                            ) : null}
                          </div>
                          {ci.body ? (
                            <ContentViewToggle
                              content={{
                                id: ci.id,
                                title: ci.title,
                                body: ci.body,
                                contentType: (ci as Record<string, unknown>).contentType as string ?? "",
                                sourceType: ci.sourceType,
                                sourceUrl: (ci as Record<string, unknown>).sourceUrl as string | undefined,
                                metadata: meta ?? null,
                              }}
                            />
                          ) : (
                            <p className="text-sm text-muted-foreground italic">Content not available.</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex flex-col items-center py-16 text-center">
                    <FileText className="h-10 w-10 text-muted-foreground/30 mb-3" />
                    <p className="font-medium">No published content yet</p>
                    <p className="text-sm text-muted-foreground mt-1">Content for this topic is being prepared.</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-64 text-center">
                <p className="text-sm text-muted-foreground">Failed to load topic content.</p>
              </div>
            )}
          </ScrollArea>
        </main>
      </div>

      {/* Complete Syllabus Viewer — the board-level curriculum document for
          the selected subject. We render the PDF inline inside the dialog
          using the browser's built-in PDF.js viewer so students can scroll,
          zoom, search, and download without leaving the page. When the
          resolver returns `found: false` (no sourcePdf in metadata and no
          filename matched under data/pdfs/…) we fall back to a friendly
          empty state with the original source URL if we have one. */}
      <Dialog
        open={syllabusPdfOpen}
        onOpenChange={(open) => setSyllabusPdfOpen(open)}
      >
        <DialogContent className="max-w-6xl w-[95vw] h-[90vh] p-0 gap-0 overflow-hidden flex flex-col">
          <DialogHeader className="px-4 py-2.5 border-b shrink-0 flex flex-row items-center gap-3 space-y-0">
            <BookOpen className="h-4 w-4 text-violet-600 shrink-0" />
            <DialogTitle className="text-sm font-semibold truncate flex-1 min-w-0">
              Complete Syllabus
              {subjectData ? ` — ${subjectData.name}` : ""}
              {activeAcademicYear ? (
                <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">
                  ({activeAcademicYear})
                </span>
              ) : null}
            </DialogTitle>
            {syllabusPdf?.found && syllabusPdf.pdfUrl ? (
              <>
                <a
                  href={syllabusPdf.pdfUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                  title="Open in new tab"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">New tab</span>
                </a>
                <a
                  href={syllabusPdf.pdfUrl}
                  download={syllabusPdf.filename}
                  className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground mr-6"
                  title="Download PDF"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Download</span>
                </a>
              </>
            ) : null}
          </DialogHeader>
          {syllabusPdfLoading ? (
            <div className="flex flex-1 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-violet-600" />
            </div>
          ) : syllabusPdf?.found && syllabusPdf.pdfUrl ? (
            <iframe
              key={syllabusPdf.pdfUrl}
              src={syllabusPdf.pdfUrl}
              className="flex-1 w-full border-0"
              title={`Complete syllabus — ${subjectData?.name ?? "subject"}`}
            />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center text-center px-6 py-12">
              <FileText className="h-10 w-10 text-muted-foreground/40 mb-3" />
              <p className="font-medium">No syllabus PDF available</p>
              <p className="text-sm text-muted-foreground mt-1 max-w-md">
                We couldn&apos;t find an official curriculum document for this
                subject. The board may not have published one yet, or it
                hasn&apos;t been indexed.
              </p>
              {syllabusPdf?.sourceUrl ? (
                <a
                  href={syllabusPdf.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-4 inline-flex items-center gap-1.5 text-sm text-violet-600 hover:text-violet-800 underline"
                >
                  <ExternalLink className="h-4 w-4" />
                  Check the board&apos;s source page
                </a>
              ) : null}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* PDF Viewer Popup */}
      <Dialog open={!!pdfPopupPath} onOpenChange={(open) => { if (!open) setPdfPopupPath(null); }}>
        <DialogContent className="max-w-4xl h-[85vh] p-0 flex flex-col">
          <DialogHeader className="px-4 py-3 border-b shrink-0">
            <div className="flex items-center justify-between">
              <DialogTitle className="text-sm">
                Source PDF — {pdfPopupPath?.split("/").pop()}
              </DialogTitle>
            </div>
          </DialogHeader>
          {pdfPopupPath && (
            <iframe
              src={`/api/admin/local-pdf?path=${encodeURIComponent(pdfPopupPath)}`}
              className="flex-1 w-full"
              title="Source PDF"
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Foundation Builder Popup */}
      {foundationOpen && (
        <div className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm" onClick={() => setFoundationOpen(false)}>
          <div
            className="absolute inset-4 sm:inset-8 lg:inset-y-8 lg:inset-x-[10%] rounded-xl bg-background border shadow-2xl flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b px-6 py-4 shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-violet-100 dark:bg-violet-900/30">
                  <Layers className="h-5 w-5 text-violet-600" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold truncate">{foundationContent?.title ?? "Foundations"}</h2>
                  <div className="flex items-center gap-2 mt-0.5">
                    {foundationContent?.cached && <Badge variant="outline" className="text-xs">Shared Content</Badge>}
                  </div>
                </div>
              </div>
              <Button variant="ghost" size="icon" className="shrink-0" onClick={() => setFoundationOpen(false)}>
                <X className="h-5 w-5" />
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-6">
              {foundationContent?.body && (
                <div className="mx-auto max-w-3xl">
                  <MarkdownRenderer content={foundationContent.body} className="prose-sm max-w-none" />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
