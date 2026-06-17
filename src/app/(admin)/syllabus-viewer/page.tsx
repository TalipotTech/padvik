"use client";

import { useEffect, useState, useCallback, useRef, useMemo, Fragment } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Search,
  Download,
  ExternalLink,
  FileText,
  Layers,
  BookOpen,
  Cpu,
  ShieldCheck,
  ArrowRight,
  Globe,
  Loader2,
  ChevronRight,
  Hash,
} from "lucide-react";
import { SELECTABLE_ACADEMIC_YEARS } from "@/lib/academic-year";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface TopicData {
  id: number;
  title: string;
  description: string | null;
  bloomLevel: string | null;
  estimatedMinutes: number | null;
  sortOrder: number;
}

interface ChapterData {
  id: number;
  chapterNumber: number;
  title: string;
  description: string | null;
  estimatedHours: string | null;
  weightagePct: string | null;
  topics: TopicData[];
}

interface SubjectInfo {
  id: number;
  name: string;
  code: string;
  maxMarks: number | null;
  grade: number;
  stream: string | null;
  /** Session label threaded from standards.academic_year so the info bar can
   * distinguish the same subject across overlapping sessions (2025-26 vs
   * 2026-27) without an extra lookup. */
  academicYear: string;
  boardCode: string;
  boardName: string;
  reviewStatus: string;
  aiModel: string | null;
  parsedAt: string | null;
  sourcePdf: string | null;
  sourceUrl: string | null;
  /** "ncert" (per-chapter PDFs, no subject-level text), "scraped" (legacy
   * CBSE scraper with a subject-level PDF), or null (no provenance). Drives
   * the NCERT badge + the empty-state copy on the raw-text panel. */
  sourceType: string | null;
  scrapeJobId: number | null;
}

interface VerifyData {
  subject: SubjectInfo;
  parsedContent: ChapterData[];
  rawText: string | null;
  hasRawText: boolean;
}

interface SubjectSummary {
  id: number;
  name: string;
  code: string;
  chaptersCount: number;
  topicsCount: number;
  sourcePdf: string | null;
  /** "ncert" when the NCERT downloader created this subject (per-chapter
   * PDFs, no subject-level rawText), otherwise the legacy scraper string
   * or null. Used to show an "NCERT" tag on the tab so admins know why
   * the raw-text panel is empty for those rows. */
  sourceType: string | null;
  reviewStatus: string | null;
  /** Hoisted onto each subject when flattening so the tab row can show a
   * session chip — two "Mathematics" tabs for the same board+grade must be
   * visually distinct when 2025-26 and 2026-27 coexist. */
  academicYear: string;
}

interface GradeSummary {
  grade: number;
  stream: string | null;
  academicYear: string;
  subjects: Array<Omit<SubjectSummary, "academicYear">>;
}

const BOARDS = [
  { code: "CBSE", label: "CBSE" },
  { code: "ICSE", label: "ICSE" },
  { code: "KL_SCERT", label: "Kerala SCERT" },
];

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------
export default function SyllabusViewerPage() {
  const [boardCode, setBoardCode] = useState("CBSE");
  const [gradeFilter, setGradeFilter] = useState("10");
  // "all" = show every session side-by-side (each subject tab carries its own
  // session chip). Picking a specific year narrows the tab row so the viewer
  // isn't cluttered when the same subject exists under 2025-26 and 2026-27.
  const [academicYearFilter, setAcademicYearFilter] = useState<string>("all");
  const [availableAcademicYears, setAvailableAcademicYears] = useState<string[]>([]);
  const [grades, setGrades] = useState<GradeSummary[]>([]);
  const [selectedSubjectId, setSelectedSubjectId] = useState<number | null>(null);
  const [viewerData, setViewerData] = useState<VerifyData | null>(null);
  const [loadingGrades, setLoadingGrades] = useState(true);
  const [loadingViewer, setLoadingViewer] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeHighlight, setActiveHighlight] = useState("");
  const rawTextRef = useRef<HTMLPreElement>(null);

  // Fetch available subjects for board+grade+academicYear
  const fetchGrades = useCallback(async () => {
    setLoadingGrades(true);
    try {
      const params = new URLSearchParams({ boardCode });
      if (gradeFilter !== "all") params.set("grade", gradeFilter);
      if (academicYearFilter !== "all") params.set("academicYear", academicYearFilter);
      const res = await fetch(`/api/admin/curriculum-explorer?${params}`);
      const json = await res.json();
      if (json.success) {
        setGrades(json.data.grades);
        // Use the API's list of distinct years that actually have data for
        // this board, so the dropdown only offers sessions the admin can
        // pick (falling back to SELECTABLE_ACADEMIC_YEARS when the board
        // has no rows yet — e.g. fresh install).
        const years: string[] = Array.isArray(json.data.availableAcademicYears)
          ? json.data.availableAcademicYears
          : [];
        setAvailableAcademicYears(
          years.length > 0 ? years : [...SELECTABLE_ACADEMIC_YEARS]
        );
        // Auto-select the first subject that has parsed chapters. We gate on
        // chaptersCount rather than sourcePdf because the NCERT pipeline
        // doesn't write a subject-level PDF — it downloads per-chapter PDFs
        // — so filtering on sourcePdf hid every 2026-27 NCERT subject even
        // though they had 14 chapters ready to view.
        const firstWithContent = json.data.grades
          .flatMap((g: GradeSummary) =>
            g.subjects
              .filter((s) => s.chaptersCount > 0)
              .map((s) => ({ ...s, academicYear: g.academicYear }))
          )
          .find((s: SubjectSummary) => s.chaptersCount > 0);
        if (firstWithContent && !selectedSubjectId) {
          setSelectedSubjectId(firstWithContent.id);
        }
      }
    } catch {
      console.error("Failed to load grades");
    } finally {
      setLoadingGrades(false);
    }
  }, [boardCode, gradeFilter, academicYearFilter, selectedSubjectId]);

  useEffect(() => {
    setSelectedSubjectId(null);
    setViewerData(null);
    fetchGrades();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardCode, gradeFilter, academicYearFilter]);

  // Fetch viewer data for selected subject
  const fetchViewer = useCallback(async () => {
    if (!selectedSubjectId) return;
    setLoadingViewer(true);
    try {
      const res = await fetch(`/api/admin/curriculum-explorer/${selectedSubjectId}/verify`);
      const json = await res.json();
      if (json.success) {
        setViewerData(json.data);
      }
    } catch {
      console.error("Failed to load viewer data");
    } finally {
      setLoadingViewer(false);
    }
  }, [selectedSubjectId]);

  useEffect(() => {
    fetchViewer();
  }, [fetchViewer]);

  // All subjects flattened for the tab selector. We hoist the grade's
  // academicYear onto each subject so the tab button can render a session
  // chip — otherwise two "Mathematics" tabs (one per session) would be
  // indistinguishable and the admin would have to guess which they're viewing.
  //
  // Filter gate: chaptersCount > 0 rather than sourcePdf !== null, because
  // the NCERT downloader creates subjects with `metadata: { source: "ncert" }`
  // (no subject-level PDF) — their PDFs live per-chapter. Gating on
  // sourcePdf silently hid every NCERT-sourced 2026-27 subject from the tab
  // row despite having fully parsed chapter trees.
  const allSubjects = useMemo<SubjectSummary[]>(
    () =>
      grades.flatMap((g) =>
        g.subjects
          .filter((s) => s.chaptersCount > 0)
          .map((s) => ({ ...s, academicYear: g.academicYear }))
      ),
    [grades]
  );

  // Search match count
  const matchCount = useMemo(() => {
    if (!searchQuery || searchQuery.length < 2 || !viewerData?.rawText) return 0;
    try {
      const regex = new RegExp(searchQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
      return (viewerData.rawText.match(regex) || []).length;
    } catch {
      return 0;
    }
  }, [searchQuery, viewerData?.rawText]);

  // Scroll to text in raw view
  function scrollToText(text: string) {
    setActiveHighlight(text);
    setSearchQuery(text);

    // Find the text in the raw view and scroll to it
    if (rawTextRef.current) {
      const marks = rawTextRef.current.querySelectorAll("mark");
      if (marks.length > 0) {
        setTimeout(() => {
          marks[0]?.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 50);
      }
    }
  }

  // Download raw text
  function downloadText() {
    if (!viewerData?.rawText || !viewerData.subject) return;
    const blob = new Blob([viewerData.rawText], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    // Include the session in the filename so the 2025-26 and 2026-27 downloads
    // don't overwrite each other in the admin's Downloads folder.
    const yearSuffix = viewerData.subject.academicYear
      ? `_${viewerData.subject.academicYear}`
      : "";
    a.download = `${viewerData.subject.boardCode}_Class${viewerData.subject.grade}_${viewerData.subject.code}${yearSuffix}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Syllabus Viewer</h1>
        <p className="text-muted-foreground">
          Read the raw syllabus text from source PDFs with chapter/topic navigation.
        </p>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Board</Label>
          <Select value={boardCode} onValueChange={setBoardCode}>
            <SelectTrigger className="w-[150px] h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BOARDS.map((b) => (
                <SelectItem key={b.code} value={b.code}>{b.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Grade</Label>
          <Select value={gradeFilter} onValueChange={setGradeFilter}>
            <SelectTrigger className="w-[130px] h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Grades</SelectItem>
              {Array.from({ length: 12 }, (_, i) => (
                <SelectItem key={i + 1} value={String(i + 1)}>Class {i + 1}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Academic Year</Label>
          <Select value={academicYearFilter} onValueChange={setAcademicYearFilter}>
            <SelectTrigger className="w-[150px] h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Sessions</SelectItem>
              {(availableAcademicYears.length > 0
                ? availableAcademicYears
                : [...SELECTABLE_ACADEMIC_YEARS]
              ).map((y) => (
                <SelectItem key={y} value={y}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Subject tabs */}
        {allSubjects.length > 0 && (
          <div className="flex-1 min-w-0">
            <Label className="text-xs">Subject</Label>
            <div className="flex gap-1 mt-1 overflow-x-auto pb-1">
              {allSubjects.map((s) => (
                // Key includes academicYear because the same subject.id is
                // unique already, but when we eventually switch to a
                // name-grouped view (collapsing both sessions under one label)
                // the compound key will prevent React reconciliation surprises.
                <button
                  key={`${s.id}-${s.academicYear}`}
                  onClick={() => setSelectedSubjectId(s.id)}
                  className={`shrink-0 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                    selectedSubjectId === s.id
                      ? "border-violet-500 bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300"
                      : "border-transparent hover:bg-muted"
                  }`}
                >
                  {s.name}
                  {/* Session chip — monospace violet pill matches the
                   * convention used in the curriculum explorer, journal,
                   * and playground so admins recognise it at a glance. */}
                  <span className="ml-1.5 rounded bg-violet-100 px-1.5 py-0.5 font-mono text-[9px] text-violet-700 dark:bg-violet-950 dark:text-violet-300">
                    {s.academicYear}
                  </span>
                  {/* NCERT provenance tag. Only shown for NCERT-sourced rows
                   * so the admin knows the raw-text panel will be empty
                   * (NCERT PDFs are downloaded per-chapter, not per subject). */}
                  {s.sourceType === "ncert" && (
                    <span className="ml-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                      NCERT
                    </span>
                  )}
                  <span className="ml-1 text-[10px] text-muted-foreground">
                    ({s.chaptersCount}ch)
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Loading / empty states */}
      {loadingGrades ? (
        <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
          Loading subjects...
        </div>
      ) : allSubjects.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <FileText className="mx-auto mb-3 size-10 opacity-30" />
            <p className="text-lg font-medium">No scraped syllabi found</p>
            <p className="mt-1 text-sm">
              Scrape some PDFs first from the{" "}
              <Link href="/scrape-jobs" className="text-violet-500 hover:underline">
                Scrape Pipeline
              </Link>{" "}
              or{" "}
              <Link href="/curriculum" className="text-violet-500 hover:underline">
                Curriculum Explorer
              </Link>.
            </p>
          </CardContent>
        </Card>
      ) : !selectedSubjectId ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            <p>Select a subject above to view its syllabus.</p>
          </CardContent>
        </Card>
      ) : loadingViewer ? (
        <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
          Loading syllabus...
        </div>
      ) : viewerData ? (
        <>
          {/* Subject info bar + toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/30 px-4 py-2.5">
            <div className="flex items-center gap-3">
              <BookOpen className="size-4 text-violet-500" />
              <div>
                <span className="text-sm font-semibold">{viewerData.subject.name}</span>
                <Badge variant="secondary" className="ml-2 text-[10px]">{viewerData.subject.code}</Badge>
                <Badge className={`ml-1.5 text-[10px] ${
                  viewerData.subject.reviewStatus === "approved"
                    ? "bg-green-500/15 text-green-600"
                    : viewerData.subject.reviewStatus === "rejected"
                      ? "bg-red-500/15 text-red-600"
                      : "bg-amber-500/15 text-amber-600"
                }`}>
                  {viewerData.subject.reviewStatus}
                </Badge>
                {viewerData.subject.sourceType === "ncert" && (
                  <Badge className="ml-1.5 bg-emerald-500/15 text-[10px] text-emerald-600">
                    NCERT
                  </Badge>
                )}
              </div>
              <span className="text-xs text-muted-foreground">
                {viewerData.subject.boardCode} · Class {viewerData.subject.grade}
                {viewerData.subject.academicYear ? (
                  <>
                    {" · "}
                    <span className="rounded bg-violet-100 px-1.5 py-0.5 font-mono text-[10px] text-violet-700 dark:bg-violet-950 dark:text-violet-300">
                      {viewerData.subject.academicYear}
                    </span>
                  </>
                ) : null}
              </span>
              {viewerData.subject.aiModel && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Cpu className="size-3" />
                  {viewerData.subject.aiModel}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Find in text..."
                  value={searchQuery}
                  onChange={(e) => { setSearchQuery(e.target.value); setActiveHighlight(""); }}
                  className="h-7 w-[180px] pl-7 text-xs"
                />
                {matchCount > 0 && (
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">
                    {matchCount} matches
                  </span>
                )}
              </div>

              {/* Actions */}
              {viewerData.rawText && (
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={downloadText}>
                  <Download className="mr-1 size-3" />
                  Download
                </Button>
              )}
              {viewerData.subject.sourceUrl && (
                <a href={viewerData.subject.sourceUrl} target="_blank" rel="noopener noreferrer">
                  <Button variant="outline" size="sm" className="h-7 text-xs">
                    <Globe className="mr-1 size-3" />
                    Original PDF
                  </Button>
                </a>
              )}
              <Link href={`/curriculum/verify/${viewerData.subject.id}`}>
                <Button variant="outline" size="sm" className="h-7 text-xs">
                  <ShieldCheck className="mr-1 size-3" />
                  Verify
                </Button>
              </Link>
              <Link href="/curriculum">
                <Button variant="outline" size="sm" className="h-7 text-xs">
                  <Layers className="mr-1 size-3" />
                  Explorer
                </Button>
              </Link>
            </div>
          </div>

          {/* Main content: TOC sidebar + raw text */}
          <div className="grid gap-4 lg:grid-cols-[280px_1fr]" style={{ height: "calc(100vh - 340px)" }}>
            {/* Left: Table of Contents */}
            <Card className="flex flex-col overflow-hidden">
              <CardHeader className="pb-2 shrink-0">
                <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">
                  Table of Contents
                </CardTitle>
                <p className="text-[10px] text-muted-foreground">
                  {viewerData.parsedContent.length} chapters ·{" "}
                  {viewerData.parsedContent.reduce((s, c) => s + c.topics.length, 0)} topics
                </p>
              </CardHeader>
              <Separator />
              <ScrollArea className="flex-1">
                <div className="p-3 space-y-1">
                  {viewerData.parsedContent.map((ch) => (
                    <div key={ch.id}>
                      {/* Chapter row */}
                      <button
                        onClick={() => scrollToText(ch.title)}
                        className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted/60 transition-colors ${
                          activeHighlight === ch.title ? "bg-violet-50 dark:bg-violet-950" : ""
                        }`}
                      >
                        <Layers className="size-3 text-indigo-400 shrink-0" />
                        <span className="font-mono text-[10px] text-muted-foreground w-4">
                          {ch.chapterNumber}.
                        </span>
                        <span className="font-medium truncate">{ch.title}</span>
                        {ch.weightagePct && (
                          <span className="ml-auto text-[9px] text-muted-foreground shrink-0">
                            {ch.weightagePct}%
                          </span>
                        )}
                      </button>

                      {/* Topics */}
                      <div className="ml-6 space-y-0.5">
                        {ch.topics.map((t) => (
                          <div key={t.id} className="flex items-center gap-1 group">
                            <button
                              onClick={() => scrollToText(t.title)}
                              className={`flex-1 flex items-center gap-1 rounded px-1.5 py-0.5 text-left text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/40 truncate ${
                                activeHighlight === t.title ? "bg-violet-50 text-violet-700 dark:bg-violet-950" : ""
                              }`}
                            >
                              <FileText className="size-2.5 shrink-0" />
                              <span className="truncate">{t.title}</span>
                            </button>
                            <Link
                              href={`/dashboard/syllabus/${t.id}`}
                              className="opacity-0 group-hover:opacity-100 transition-opacity"
                              title="Go to topic detail"
                            >
                              <ArrowRight className="size-3 text-violet-500 hover:text-violet-700" />
                            </Link>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}

                  {viewerData.parsedContent.length === 0 && (
                    <p className="py-4 text-center text-xs text-muted-foreground">
                      No parsed content yet
                    </p>
                  )}
                </div>
              </ScrollArea>
            </Card>

            {/* Right: Raw syllabus text */}
            <Card className="flex flex-col overflow-hidden">
              <CardHeader className="pb-2 shrink-0 flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">
                    Raw Syllabus Text
                  </CardTitle>
                  {viewerData.rawText && (
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {viewerData.rawText.length.toLocaleString()} characters
                      {viewerData.subject.sourcePdf && (
                        <> · <span className="font-mono">{viewerData.subject.sourcePdf.split("/").pop()}</span></>
                      )}
                    </p>
                  )}
                </div>
                {viewerData.rawText && matchCount > 0 && (
                  <Badge variant="outline" className="text-[10px]">
                    <Hash className="mr-0.5 size-2.5" />
                    {matchCount} matches
                  </Badge>
                )}
              </CardHeader>
              <Separator />
              <ScrollArea className="flex-1">
                <div className="p-4">
                  {viewerData.rawText ? (
                    <pre
                      ref={rawTextRef}
                      className="whitespace-pre-wrap text-xs leading-relaxed font-mono text-foreground/90"
                    >
                      <HighlightText
                        text={viewerData.rawText}
                        query={searchQuery}
                      />
                    </pre>
                  ) : viewerData.subject.sourceType === "ncert" ? (
                    // NCERT subjects download one PDF per chapter, so there's
                    // no aggregated subject-level raw text. Point the admin
                    // at the chapter tree (left sidebar) and let them drill
                    // into individual chapter detail pages for raw content.
                    <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                      <FileText className="mb-3 size-10 opacity-30" />
                      <p className="text-sm font-medium">NCERT per-chapter content</p>
                      <p className="mt-1 max-w-sm text-center text-xs">
                        This subject was sourced from NCERT — each chapter has
                        its own PDF. Use the Table of Contents on the left to
                        open any chapter&apos;s detail view.
                      </p>
                      <Link href="/curriculum" className="mt-3">
                        <Button variant="outline" size="sm" className="text-xs">
                          Open in Curriculum Explorer
                        </Button>
                      </Link>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                      <FileText className="mb-3 size-10 opacity-30" />
                      <p className="text-sm font-medium">No raw text available</p>
                      <p className="mt-1 text-xs">
                        Re-run the scraper to save PDF text locally.
                      </p>
                      <Link href="/scrape-jobs" className="mt-3">
                        <Button variant="outline" size="sm" className="text-xs">
                          Go to Scrape Pipeline
                        </Button>
                      </Link>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </Card>
          </div>
        </>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Highlight component
// ---------------------------------------------------------------------------
function HighlightText({ text, query }: { text: string; query: string }) {
  if (!query || query.length < 2) return <>{text}</>;

  try {
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const parts = text.split(new RegExp(`(${escaped})`, "gi"));

    return (
      <>
        {parts.map((part, i) =>
          part.toLowerCase() === query.toLowerCase() ? (
            <mark key={i} className="rounded bg-yellow-200 px-0.5 dark:bg-yellow-800">
              {part}
            </mark>
          ) : (
            <Fragment key={i}>{part}</Fragment>
          )
        )}
      </>
    );
  } catch {
    return <>{text}</>;
  }
}
