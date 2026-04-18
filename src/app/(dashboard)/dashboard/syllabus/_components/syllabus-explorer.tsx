"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  BookOpen, ChevronRight, ChevronDown, ChevronLeft, ChevronsLeft, ChevronsRight,
  FileText, Layers, Search, Filter, CheckCircle2, Loader2,
  GraduationCap, Eye, MessageSquare, HelpCircle, Sparkles, AlertTriangle,
  FileImage, X,
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
// Component
// ---------------------------------------------------------------------------

export function SyllabusExplorer({ userRole = "student" }: { userRole?: string }) {
  const isAdmin = userRole === "admin";
  const isTeacher = userRole === "teacher";
  const canSwitchBoard = isAdmin || isTeacher;
  const globalSelection = useBoardSelection();

  // Local board/grade override for this page (admin/teacher can freely switch)
  const [localBoardId, setLocalBoardId] = useState<number | null>(null);
  const [localGrade, setLocalGrade] = useState<number | null>(null);

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
  // Foundation popup state
  const [foundationLoading, setFoundationLoading] = useState(false);
  const [foundationContent, setFoundationContent] = useState<{ title: string; body: string; cached: boolean; prerequisiteCount: number } | null>(null);
  const [foundationOpen, setFoundationOpen] = useState(false);
  const [gapInfo, setGapInfo] = useState<{ totalTopics: number; topicsMissing: number; estimatedCostUsd: number } | null>(null);
  const [filling, setFilling] = useState(false);
  const [fillResult, setFillResult] = useState<{ processed: number; totalCostUsd: number; errors: string[] } | null>(null);

  // Topic-level progress for the selected subject
  const [topicProgress, setTopicProgress] = useState<Record<number, { percent: number; understanding: string | null }>>({});
  // Per-subject progress summary (for the dropdown)
  const [subjectProgressMap, setSubjectProgressMap] = useState<Record<number, number>>({});

  const { data: subjects, loading: subjectsLoading } = useData(
    () => boardId && grade ? getSubjects(boardId, grade) : Promise.resolve([]),
    [boardId, grade],
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

        {/* Info */}
        {boardId && grade ? (
          <span className="text-[10px] text-muted-foreground hidden sm:inline">
            {boardName ?? ""}{boardName ? " · " : ""}Class {grade}
          </span>
        ) : null}

        {/* Open in Learn view */}
        {selectedTopicId && (
          <Link href={`/dashboard/learn/${selectedTopicId}`}>
            <Button variant="ghost" size="sm" className="h-7 text-xs">
              <GraduationCap className="mr-1 h-3 w-3" /> Playground
            </Button>
          </Link>
        )}

        {/* Content gap indicator + Fill button (admin only) */}
        {isAdmin && gapInfo && gapInfo.topicsMissing > 0 && (
          <>
            <Separator orientation="vertical" className="h-5" />
            <span className="text-[10px] text-amber-600 flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              {gapInfo.topicsMissing}/{gapInfo.totalTopics} topics need content
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs border-violet-300 text-violet-600 hover:bg-violet-50"
              onClick={fillGaps}
              disabled={filling}
            >
              {filling ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Sparkles className="mr-1 h-3 w-3" />}
              {filling ? "Generating..." : `Fill Gaps (~$${gapInfo.estimatedCostUsd.toFixed(2)})`}
            </Button>
          </>
        )}
        {isAdmin && gapInfo && gapInfo.topicsMissing === 0 && (
          <>
            <Separator orientation="vertical" className="h-5" />
            <span className="text-[10px] text-emerald-600 flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3" /> All {gapInfo.totalTopics} topics have content
            </span>
          </>
        )}
        {isAdmin && fillResult && (
          <span className="text-[10px] text-emerald-600">
            Generated {fillResult.processed} topics (${ fillResult.totalCostUsd.toFixed(4)})
          </span>
        )}
      </div>

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
                          <span className="truncate">{chapter.title}</span>
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
                                  <span className="truncate flex-1">{topic.title}</span>
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
                    <span>Ch {topicContent.topic.chapter.chapterNumber}: {topicContent.topic.chapter.title}</span>
                  </div>
                  <h1 className="text-xl font-bold">{topicContent.topic.title}</h1>
                  {topicContent.topic.description && (
                    <p className="text-sm text-muted-foreground mt-1">{topicContent.topic.description}</p>
                  )}
                  <div className="flex items-center gap-2 mt-2">
                    {topicContent.topic.estimatedMinutes && (
                      <Badge variant="outline" className="text-[10px]">~{topicContent.topic.estimatedMinutes} min</Badge>
                    )}
                    <Badge variant="outline" className="text-[10px]">{topicContent.contentItems.length} content items</Badge>
                    <Link href={`/dashboard/learn/${selectedTopicId}`}>
                      <Badge variant="secondary" className="text-[10px] cursor-pointer hover:bg-primary/10">
                        <GraduationCap className="mr-0.5 h-3 w-3" /> Playground
                      </Badge>
                    </Link>
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
