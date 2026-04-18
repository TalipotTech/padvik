"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
// Dialog import removed — using custom fullscreen overlay for foundations
import { MarkdownRenderer } from "@/components/content/markdown-renderer";
import { ContentViewToggle } from "@/components/content/content-view-toggle";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import {
  BookOpen, Bookmark, BookmarkCheck, ChevronLeft, ChevronRight, Clock,
  FileText, HelpCircle, Loader2, MessageSquare, Search, Send, CheckCircle2,
  X, ArrowLeft, Sparkles, ChevronsLeft, ChevronsRight, ChevronDown,
  StickyNote, Play, Video, Trash2, Plus, Circle, Copy, Camera, GraduationCap, Award,
  Minimize2, Maximize2, Layers,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TopicData {
  topic: {
    id: number; title: string; description: string | null;
    learningObjectives: unknown; bloomLevel: string | null; estimatedMinutes: number | null;
    chapter: { id: number; number: number; title: string };
    subject: { id: number; name: string; code: string };
    grade: number; board: { code: string; name: string };
  };
  content: Array<{
    id: number; title: string; body: string; contentType: string;
    sourceType: string; language: string; qualityScore: string | null;
    metadata: Record<string, unknown> | null;
  }>;
  pendingContent: Array<{ id: number; title: string; body: string; contentType: string; sourceType: string; qualityScore: string | null; language: string; metadata: Record<string, unknown> | null }>;
  questionCount: number;
  relatedTopics: Array<{ id: number; title: string }>;
  navigation: { prev: { id: number; title: string } | null; next: { id: number; title: string } | null };
  chapterTree: Array<{ id: number; number: number; title: string; topics: Array<{ id: number; title: string; progress?: number; understanding?: string | null }> }>;
  progress: { completionPercent: number; sectionsRead: string[] } | null;
  isBookmarked: boolean;
}

interface ChatMessage { role: "user" | "assistant"; content: string; timestamp: string }
interface UserNote { id: number; title: string | null; body: string; createdAt: string; noteType?: string; imageUrl?: string | null }
interface UserVideo { id: number; youtubeUrl: string; title: string | null; thumbnailUrl: string | null }
interface ExamResult { attemptId: number; totalScore: number; maxScore: number; percentage: number; grade: string; responses: Array<{ questionId: number; isCorrect: boolean | null; marksObtained: number; correctAnswer: string | null; solution: string | null; userAnswer: string }> }
interface Question {
  id: number; question_type: string; difficulty: string; question_text: string;
  options: Array<{ label: string; text: string; isCorrect: boolean }> | null;
  correct_answer: string | null; solution: string | null; marks: string;
  source_type: string; source_year: number | null;
}

// ---------------------------------------------------------------------------
// Main Playground Component
// ---------------------------------------------------------------------------

export function LearnView({ topicId }: { topicId: number }) {
  const searchParams = useSearchParams();
  const initialPanel = searchParams.get("panel"); // chat, notes, exercises, pyqs, videos

  // Core data
  const [data, setData] = useState<TopicData | null>(null);
  const [loading, setLoading] = useState(true);

  // UI state
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [rightPanel, setRightPanel] = useState<string | null>(initialPanel);
  const [panelSize, setPanelSize] = useState<"normal" | "wide" | "overlay">("normal");
  const [isBookmarked, setIsBookmarked] = useState(false);
  const [understanding, setUnderstanding] = useState<"red" | "orange" | "green" | null>(null);

  // Chat state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [chatSuggestions, setChatSuggestions] = useState<string[]>([]);
  const [chatProvider, setChatProvider] = useState("claude");
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Notes state
  const [notes, setNotes] = useState<UserNote[]>([]);
  const [newNote, setNewNote] = useState("");

  // Foundations state
  const [foundationLoading, setFoundationLoading] = useState(false);
  const [foundationContent, setFoundationContent] = useState<{ title: string; body: string; cached: boolean; prerequisiteCount: number } | null>(null);
  const [foundationOpen, setFoundationOpen] = useState(false);

  // Topic progress for sidebar (fetched from dedicated progress API)
  const [sidebarProgress, setSidebarProgress] = useState<Record<number, { percent: number; understanding: string | null }>>({});

  // Videos state
  const [videos, setVideos] = useState<UserVideo[]>([]);
  const [newVideoUrl, setNewVideoUrl] = useState("");
  const [suggestedVideos, setSuggestedVideos] = useState<Array<{ videoId: string; title: string; channelTitle: string; thumbnailUrl: string; viewCount: number; duration: string; url: string }>>([]);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [suggestQuery, setSuggestQuery] = useState("");

  // Exercise state
  const [exercises, setExercises] = useState<Question[]>([]);
  const [exerciseRevealed, setExerciseRevealed] = useState<Set<number>>(new Set());

  // PYQ state
  const [pyqs, setPyqs] = useState<Question[]>([]);
  const [pyqRevealed, setPyqRevealed] = useState<Set<number>>(new Set());

  // Camera / image upload
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [uploadingImage, setUploadingImage] = useState(false);

  // Exam state
  const [examState, setExamState] = useState<"idle" | "taking" | "submitted">("idle");
  const [examAttemptId, setExamAttemptId] = useState<number | null>(null);
  const [examQuestions, setExamQuestions] = useState<Question[]>([]);
  const [examAnswers, setExamAnswers] = useState<Map<number, string[]>>(new Map());
  const [examResult, setExamResult] = useState<ExamResult | null>(null);
  const [examLoading, setExamLoading] = useState(false);
  const [examQuestionCount, setExamQuestionCount] = useState(5);

  // Selection tooltip
  const [selectionPos, setSelectionPos] = useState<{ x: number; y: number; text: string } | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // Auto-load data for initial panel from URL param
  useEffect(() => {
    if (initialPanel === "exercises") loadExercises();
    if (initialPanel === "pyqs") loadPyqs();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Data fetching ----

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/learn/topic/${topicId}`);
      const json = await res.json();
      if (json.success) {
        setData(json.data);
        setIsBookmarked(json.data.isBookmarked);
      }
    } catch { /* silent */ } finally { setLoading(false); }
  }, [topicId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Store last visited topic for Playground nav link
  useEffect(() => {
    try { localStorage.setItem("padvik-last-topic", String(topicId)); } catch { /* ignore */ }
  }, [topicId]);

  // Fetch sidebar progress from dedicated endpoint once we know the subject
  useEffect(() => {
    if (!data?.topic?.subject?.id) return;
    fetch(`/api/learn/progress?subjectId=${data.topic.subject.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (json?.success) setSidebarProgress(json.data.topics ?? {});
      })
      .catch(() => {});
  }, [data?.topic?.subject?.id]);

  // Load understanding level
  useEffect(() => {
    fetch(`/api/learn/understanding?topicId=${topicId}`)
      .then((r) => r.json())
      .then((json) => { if (json.success && json.data) setUnderstanding(json.data.understandingLevel as "red" | "orange" | "green"); })
      .catch(() => {});
  }, [topicId]);

  // Load chat history
  useEffect(() => {
    fetch(`/api/learn/chat?topicId=${topicId}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.success && json.data.length > 0) {
          const conv = json.data[0];
          setConversationId(conv.id);
          const msgs = (conv.messages as Array<ChatMessage & { suggestions?: string[] }>) ?? [];
          setChatMessages(msgs);
          // Restore last suggestions from the last assistant message
          const lastAssistant = [...msgs].reverse().find((m) => m.role === "assistant");
          if (lastAssistant && (lastAssistant as { suggestions?: string[] }).suggestions) {
            setChatSuggestions((lastAssistant as { suggestions?: string[] }).suggestions!);
          }
        }
      }).catch(() => {});
  }, [topicId]);

  // Load notes
  useEffect(() => {
    fetch(`/api/learn/notes?topicId=${topicId}`)
      .then((r) => r.json())
      .then((json) => { if (json.success) setNotes(json.data); })
      .catch(() => {});
  }, [topicId]);

  // Load videos
  useEffect(() => {
    fetch(`/api/learn/videos?topicId=${topicId}`)
      .then((r) => r.json())
      .then((json) => { if (json.success) setVideos(json.data); })
      .catch(() => {});
  }, [topicId]);

  // Scroll chat to bottom
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatMessages]);

  // ---- Text selection detection ----
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleMouseUp(e: MouseEvent) {
      // Don't dismiss if clicking inside the tooltip itself
      if (tooltipRef.current?.contains(e.target as Node)) return;

      const selection = window.getSelection();
      const text = selection?.toString().trim() ?? "";
      if (text.length >= 3 && contentRef.current?.contains(e.target as Node)) {
        const range = selection!.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        setSelectionPos({ x: rect.left + rect.width / 2, y: rect.top - 10, text });
      } else {
        // Small delay to allow tooltip button clicks to process first
        setTimeout(() => {
          const currentSelection = window.getSelection()?.toString().trim() ?? "";
          if (currentSelection.length < 3) setSelectionPos(null);
        }, 100);
      }
    }
    document.addEventListener("mouseup", handleMouseUp);
    return () => document.removeEventListener("mouseup", handleMouseUp);
  }, []);

  // ---- Actions ----

  async function toggleBookmark() {
    await fetch("/api/learn/bookmark", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ topicId, title: data?.topic.title }) });
    setIsBookmarked((prev) => !prev);
  }

  async function setUnderstandingLevel(level: "red" | "orange" | "green") {
    setUnderstanding(level);
    await fetch("/api/learn/understanding", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ topicId, level }) });
  }

  async function markComplete() {
    const contentId = data?.content[0]?.id;
    if (!contentId) return;
    await fetch("/api/learn/progress", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contentItemId: contentId, completionPercent: 100 }) });
    fetchData();
  }

  async function sendChat(messageText?: string) {
    const msg = messageText ?? chatInput.trim();
    if (!msg) return;
    setChatSending(true);
    setChatInput("");
    setChatMessages((prev) => [...prev, { role: "user", content: msg, timestamp: new Date().toISOString() }]);
    try {
      const res = await fetch("/api/learn/chat", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topicId, message: msg, conversationId, provider: chatProvider, selectedText: selectionPos?.text }) });
      const json = await res.json();
      if (json.success) {
        setChatMessages((prev) => [...prev, { role: "assistant", content: json.data.message, timestamp: new Date().toISOString() }]);
        setConversationId(json.data.conversationId);
        setChatSuggestions(json.data.suggestions ?? []);
      } else {
        setChatMessages((prev) => [...prev, { role: "assistant", content: `Error: ${json.error?.message ?? "Failed to get response"}`, timestamp: new Date().toISOString() }]);
      }
    } catch (err) {
      setChatMessages((prev) => [...prev, { role: "assistant", content: `Network error: ${err instanceof Error ? err.message : "Failed to connect"}`, timestamp: new Date().toISOString() }]);
    } finally { setChatSending(false); setSelectionPos(null); }
  }

  async function addNote() {
    if (!newNote.trim()) return;
    const res = await fetch("/api/learn/notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ topicId, body: newNote }) });
    const json = await res.json();
    if (json.success) { setNotes((prev) => [json.data, ...prev]); setNewNote(""); }
  }

  async function deleteNote(id: number) {
    await fetch(`/api/learn/notes?id=${id}`, { method: "DELETE" });
    setNotes((prev) => prev.filter((n) => n.id !== id));
  }

  async function handleBuildFoundations() {
    // First try GET to check for existing shared content
    setFoundationLoading(true);
    try {
      const checkRes = await fetch(`/api/learn/foundations?topicId=${topicId}`);
      const checkJson = await checkRes.json();

      if (checkJson.success && checkJson.data) {
        // Shared content exists — show it
        setFoundationContent({
          title: checkJson.data.title,
          body: checkJson.data.body,
          cached: true,
          prerequisiteCount: 0,
        });
        setFoundationOpen(true);
        setFoundationLoading(false);
        return;
      }

      // No shared content — generate via POST
      const res = await fetch("/api/learn/foundations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topicId }),
      });
      const json = await res.json();
      if (json.success) {
        setFoundationContent({
          title: json.data.title,
          body: json.data.body,
          cached: json.data.cached,
          prerequisiteCount: json.data.prerequisiteCount,
        });
        setFoundationOpen(true);
      }
    } catch (err) {
      console.error("Foundation build failed:", err);
    } finally {
      setFoundationLoading(false);
    }
  }

  async function addVideo() {
    if (!newVideoUrl.trim()) return;
    try {
      const res = await fetch("/api/learn/videos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ topicId, youtubeUrl: newVideoUrl }) });
      const json = await res.json();
      if (json.success) { setVideos((prev) => [...prev, json.data]); setNewVideoUrl(""); }
      else { alert(json.error?.message ?? "Failed to save video"); }
    } catch { alert("Network error saving video"); }
  }

  async function deleteVideo(id: number) {
    await fetch(`/api/learn/videos?id=${id}`, { method: "DELETE" });
    setVideos((prev) => prev.filter((v) => v.id !== id));
  }

  async function suggestVideos(query?: string) {
    setSuggestLoading(true);
    try {
      const params = new URLSearchParams({ topicId: String(topicId), maxResults: "8" });
      if (query) params.set("query", query);
      const res = await fetch(`/api/learn/videos/suggest?${params}`);
      const json = await res.json();
      if (json.success) {
        setSuggestedVideos(json.data.videos);
        if (!query) setSuggestQuery(json.data.query);
      } else { alert(json.error?.message ?? "Search failed"); }
    } catch { alert("Network error"); } finally { setSuggestLoading(false); }
  }

  async function saveSuggestedVideo(video: { videoId: string; title: string; channelTitle: string; url: string; viewCount: number }) {
    try {
      const res = await fetch("/api/learn/videos/suggest", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topicId, videoId: video.videoId, title: video.title, url: video.url, channelTitle: video.channelTitle, viewCount: video.viewCount }) });
      const json = await res.json();
      if (json.success) {
        setVideos((prev) => [...prev, json.data]);
        setSuggestedVideos((prev) => prev.filter((v) => v.videoId !== video.videoId));
      }
    } catch { alert("Save failed"); }
  }

  async function loadExercises() {
    const res = await fetch(`/api/learn/exercises?topicId=${topicId}&limit=5`);
    const json = await res.json();
    if (json.success) { setExercises(json.data); setExerciseRevealed(new Set()); }
  }

  async function loadPyqs() {
    const res = await fetch(`/api/learn/previous-year?topicId=${topicId}&limit=20`);
    const json = await res.json();
    if (json.success) setPyqs(json.data);
  }

  async function highlightText(color: "red" | "orange" | "green") {
    if (!selectionPos || !data?.content[0]) return;
    const selection = window.getSelection();
    const text = selection?.toString().trim() ?? "";
    if (text.length < 3) return;
    await fetch("/api/learn/highlight", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contentItemId: data.content[0].id, highlightedText: text, color, startOffset: 0, endOffset: text.length }) });
    setSelectionPos(null);
    window.getSelection()?.removeAllRanges();
  }

  function askAiWithSelection() {
    if (!selectionPos) return;
    setChatInput(`Explain this: "${selectionPos.text.slice(0, 300)}"`);
    setRightPanel("chat");
    setSelectionPos(null);
  }

  // Camera upload for handwritten notes
  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingImage(true);
    try {
      // Compress client-side
      const { compressImage } = await import("@/lib/image-compress");
      const { blob } = await compressImage(file);
      const formData = new FormData();
      formData.append("file", blob, `note-${Date.now()}.jpg`);
      formData.append("topicId", String(topicId));

      const res = await fetch("/api/learn/notes/upload", { method: "POST", body: formData });
      const json = await res.json();
      if (json.success) {
        setNotes((prev) => [json.data, ...prev]);
      } else {
        alert(json.error?.message ?? "Upload failed");
      }
    } catch (err) {
      alert(`Upload error: ${err instanceof Error ? err.message : "Failed"}`);
    } finally {
      setUploadingImage(false);
      if (imageInputRef.current) imageInputRef.current.value = "";
    }
  }

  // Exam functions
  async function startExam() {
    setExamLoading(true);
    try {
      const res = await fetch("/api/learn/exam/start", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topicId, questionCount: examQuestionCount }) });
      const json = await res.json();
      if (json.success) {
        setExamAttemptId(json.data.attemptId);
        setExamQuestions(json.data.questions.map((q: Record<string, unknown>) => ({
          id: q.id, question_type: q.questionType, difficulty: q.difficulty,
          question_text: q.questionText, options: q.options, marks: q.marks,
          correct_answer: null, solution: null, source_type: "", source_year: null,
        })));
        setExamAnswers(new Map());
        setExamResult(null);
        setExamState("taking");
      } else {
        alert(json.error?.message ?? "Failed to start exam");
      }
    } catch { alert("Network error"); } finally { setExamLoading(false); }
  }

  async function submitExam() {
    if (!examAttemptId) return;
    setExamLoading(true);
    try {
      const responses = Array.from(examAnswers.entries()).map(([qId, selected]) => ({
        questionId: qId, selectedOptionIds: selected,
      }));
      const res = await fetch(`/api/learn/exam/${examAttemptId}/submit`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ responses }) });
      const json = await res.json();
      if (json.success) {
        setExamResult(json.data);
        setExamState("submitted");
      } else { alert(json.error?.message ?? "Submit failed"); }
    } catch { alert("Network error"); } finally { setExamLoading(false); }
  }

  function selectExamOption(questionId: number, optionLabel: string) {
    setExamAnswers((prev) => {
      const next = new Map(prev);
      next.set(questionId, [optionLabel]);
      return next;
    });
  }

  // ---- Loading / Error states ----

  if (loading) {
    return (
      <div className="flex h-[calc(100vh-8rem)] gap-4">
        <Skeleton className="w-64 shrink-0 rounded-lg" />
        <div className="flex-1 space-y-4"><Skeleton className="h-10 w-96" /><Skeleton className="h-64 w-full" /></div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <FileText className="h-12 w-12 text-muted-foreground/50 mb-4" />
        <p className="font-medium">Topic not found</p>
        <Button asChild variant="outline" className="mt-4"><Link href="/dashboard/learn">Back to My Learning</Link></Button>
      </div>
    );
  }

  const { topic, content, pendingContent, questionCount, navigation, chapterTree } = data;
  const allContent = content.length > 0 ? content : pendingContent;
  const allTopics = chapterTree.flatMap((ch) => ch.topics);
  const currentIdx = allTopics.findIndex((t) => t.id === topicId);

  return (
    <div className="flex h-[calc(100vh-8rem)] gap-0 -mx-4 lg:-mx-6 -my-4 lg:-my-6">

      {/* ======= LEFT SIDEBAR — Chapter TOC (desktop) ======= */}
      {sidebarOpen && (
        <aside className="hidden lg:flex w-64 shrink-0 flex-col border-r bg-card">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <div className="min-w-0">
              <h3 className="text-xs font-semibold truncate">{topic.subject.name}</h3>
              <p className="text-[10px] text-muted-foreground">{topic.board.code} · Class {topic.grade}</p>
            </div>
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setSidebarOpen(false)}><X className="h-3 w-3" /></Button>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-1.5 space-y-0.5">
              {chapterTree.map((ch) => (
                <div key={ch.id}>
                  <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Ch {ch.number}: {ch.title}</div>
                  {ch.topics.map((t) => {
                    const sp = sidebarProgress[t.id];
                    const pct = sp?.percent ?? 0;
                    const und = sp?.understanding ?? null;
                    let dotColor = "bg-gray-300 dark:bg-gray-600";
                    if (und === "green") dotColor = "bg-emerald-500";
                    else if (und === "orange") dotColor = "bg-amber-500";
                    else if (und === "red") dotColor = "bg-red-500";
                    else if (pct >= 80) dotColor = "bg-emerald-500";
                    else if (pct >= 40) dotColor = "bg-amber-500";
                    else if (pct > 0) dotColor = "bg-blue-500";
                    return (
                      <Link key={t.id} href={`/dashboard/learn/${t.id}`}>
                        <div className={`flex items-center gap-1.5 rounded px-2 py-1 text-[11px] transition-colors ${t.id === topicId ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:bg-muted/50"}`}>
                          <span className={`h-2 w-2 rounded-full shrink-0 ${dotColor}`} title={pct > 0 ? `${pct}%` : "Not started"} />
                          <span className="truncate flex-1">{t.title}</span>
                          {pct > 0 && <span className="text-[9px] tabular-nums text-muted-foreground/70 shrink-0">{pct}%</span>}
                        </div>
                      </Link>
                    );
                  })}
                </div>
              ))}
            </div>
          </ScrollArea>
          <div className="border-t px-3 py-1.5 text-[10px] text-muted-foreground">
            {currentIdx + 1}/{allTopics.length} topics · {data.progress?.completionPercent ?? 0}% complete
          </div>
        </aside>
      )}

      {/* ======= MOBILE SIDEBAR — Sheet drawer ======= */}
      <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
        <SheetContent side="left" className="w-72 p-0">
          <SheetTitle className="px-3 py-2 text-xs font-semibold border-b">
            {topic.subject.name} · {topic.board.code} Class {topic.grade}
          </SheetTitle>
          <ScrollArea className="h-[calc(100vh-4rem)]">
            <div className="p-1.5 space-y-0.5">
              {chapterTree.map((ch) => (
                <div key={ch.id}>
                  <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Ch {ch.number}: {ch.title}</div>
                  {ch.topics.map((t) => {
                    const sp = sidebarProgress[t.id];
                    const pct = sp?.percent ?? 0;
                    const und = sp?.understanding ?? null;
                    let dotColor = "bg-gray-300 dark:bg-gray-600";
                    if (und === "green") dotColor = "bg-emerald-500";
                    else if (und === "orange") dotColor = "bg-amber-500";
                    else if (und === "red") dotColor = "bg-red-500";
                    else if (pct >= 80) dotColor = "bg-emerald-500";
                    else if (pct >= 40) dotColor = "bg-amber-500";
                    else if (pct > 0) dotColor = "bg-blue-500";
                    return (
                      <Link key={t.id} href={`/dashboard/learn/${t.id}`} onClick={() => setMobileSidebarOpen(false)}>
                        <div className={`flex items-center gap-1.5 rounded px-2 py-1 text-[11px] transition-colors ${t.id === topicId ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:bg-muted/50"}`}>
                          <span className={`h-2 w-2 rounded-full shrink-0 ${dotColor}`} />
                          <span className="truncate flex-1">{t.title}</span>
                          {pct > 0 && <span className="text-[9px] tabular-nums text-muted-foreground/70 shrink-0">{pct}%</span>}
                        </div>
                      </Link>
                    );
                  })}
                </div>
              ))}
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>

      {/* ======= MAIN AREA ======= */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Top toolbar — row 1: navigation + key actions */}
        <div className="flex items-center justify-between border-b px-2 py-1 shrink-0 bg-card gap-1">
          <div className="flex items-center gap-1">
            {/* Mobile: chapter sidebar toggle */}
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0 lg:hidden" onClick={() => setMobileSidebarOpen(true)}><Layers className="h-3.5 w-3.5" /></Button>
            {/* Desktop: sidebar toggle */}
            {!sidebarOpen && <Button variant="ghost" size="sm" className="h-7 w-7 p-0 hidden lg:flex" onClick={() => setSidebarOpen(true)}><BookOpen className="h-3.5 w-3.5" /></Button>}
            <Link href="/dashboard/learn"><Button variant="ghost" size="sm" className="h-7 text-xs px-1.5"><ArrowLeft className="mr-0.5 h-3 w-3" /><span className="hidden sm:inline">My Learning</span></Button></Link>
            <span className="text-[10px] text-muted-foreground truncate max-w-[120px] hidden md:inline">{topic.subject.name} · Ch {topic.chapter.number}</span>
          </div>

          <div className="flex items-center gap-0.5">
            {/* Understanding rating */}
            <div className="flex items-center gap-0.5 border rounded-md px-1 py-0.5">
              {(["red", "orange", "green"] as const).map((color) => (
                <button key={color} onClick={() => setUnderstandingLevel(color)} title={color === "red" ? "Tough" : color === "orange" ? "Almost OK" : "Understood"}
                  className={`h-5 w-5 rounded-full flex items-center justify-center transition-all ${understanding === color ? "ring-2 ring-offset-1 ring-current" : "opacity-50 hover:opacity-100"} ${color === "red" ? "bg-red-500" : color === "orange" ? "bg-orange-500" : "bg-green-500"}`}>
                  {understanding === color && <CheckCircle2 className="h-3 w-3 text-white" />}
                </button>
              ))}
            </div>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={toggleBookmark} >
              {isBookmarked ? <BookmarkCheck className="h-4 w-4 text-violet-600" /> : <Bookmark className="h-4 w-4" />}
            </Button>
            <Separator orientation="vertical" className="h-5 mx-0.5" />
            {/* Navigation prev/next */}
            <span className="text-[10px] text-muted-foreground tabular-nums">{currentIdx + 1}/{allTopics.length}</span>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" disabled={currentIdx <= 0} onClick={() => { if (currentIdx > 0) window.location.href = `/dashboard/learn/${allTopics[currentIdx - 1].id}`; }}><ChevronLeft className="h-3.5 w-3.5" /></Button>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" disabled={currentIdx >= allTopics.length - 1} onClick={() => { if (currentIdx < allTopics.length - 1) window.location.href = `/dashboard/learn/${allTopics[currentIdx + 1].id}`; }}><ChevronRight className="h-3.5 w-3.5" /></Button>
          </div>
        </div>

        {/* Top toolbar — row 2: panel toggles (scrollable on mobile) */}
        <div className="flex items-center gap-1 border-b px-2 py-1 shrink-0 bg-card overflow-x-auto scrollbar-none">
          {(["chat", "notes", "exercises", "pyqs", "exam", "videos"] as const).map((tab) => (
            <Button key={tab} variant={rightPanel === tab ? "default" : "ghost"} size="sm" className="h-7 text-[10px] px-2 shrink-0"
              onClick={() => { setRightPanel(rightPanel === tab ? null : tab); if (tab === "exercises" && exercises.length === 0) loadExercises(); if (tab === "pyqs" && pyqs.length === 0) loadPyqs(); }}>
              {tab === "chat" && <><MessageSquare className="h-3 w-3 mr-0.5" />AI</>}
              {tab === "notes" && <><StickyNote className="h-3 w-3 mr-0.5" />Notes</>}
              {tab === "exercises" && <><Play className="h-3 w-3 mr-0.5" />Test</>}
              {tab === "pyqs" && <><HelpCircle className="h-3 w-3 mr-0.5" />PYQ</>}
              {tab === "exam" && <><GraduationCap className="h-3 w-3 mr-0.5" />Exam</>}
              {tab === "videos" && <><Video className="h-3 w-3 mr-0.5" />Video</>}
            </Button>
          ))}
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* ======= CONTENT AREA ======= */}
          <ScrollArea className="flex-1">
            <div ref={contentRef} className="max-w-3xl mx-auto px-4 py-6 lg:px-8 relative">
              {/* Topic header */}
              <div className="mb-5">
                <h1 className="text-xl font-bold">{topic.title}</h1>
                <div className="flex flex-wrap items-center gap-1.5 mt-2">
                  <Badge variant="secondary" className="text-[10px]">{topic.subject.name}</Badge>
                  <Badge variant="outline" className="text-[10px]">Ch {topic.chapter.number}</Badge>
                  <Badge variant="outline" className="text-[10px]">{topic.board.code} · Class {topic.grade}</Badge>
                  {topic.estimatedMinutes && <Badge variant="outline" className="text-[10px]"><Clock className="h-3 w-3 mr-0.5" />~{topic.estimatedMinutes}m</Badge>}
                  {questionCount > 0 && <Badge variant="outline" className="text-[10px]"><HelpCircle className="h-3 w-3 mr-0.5" />{questionCount} Qs</Badge>}
                  {understanding && (
                    <Badge className="text-[10px]" style={{ backgroundColor: understanding === "red" ? "#fecaca" : understanding === "orange" ? "#fed7aa" : "#bbf7d0", color: understanding === "red" ? "#dc2626" : understanding === "orange" ? "#ea580c" : "#16a34a" }}>
                      {understanding === "red" ? "Tough" : understanding === "orange" ? "Almost OK" : "Understood"}
                    </Badge>
                  )}
                </div>
                {topic.description && <p className="text-sm text-muted-foreground mt-2">{topic.description}</p>}
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3 gap-1.5"
                  disabled={foundationLoading}
                  onClick={handleBuildFoundations}
                >
                  {foundationLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Layers className="h-3.5 w-3.5" />}
                  {foundationLoading ? "Building..." : "Build Foundations"}
                </Button>
              </div>

              <Separator className="mb-5" />

              {/* Content rendering */}
              {allContent.length > 0 ? (
                <div className="space-y-6">
                  {allContent.map((ci) => (
                    <div key={ci.id}>
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-sm font-medium">{ci.title}</span>
                        <Badge variant="secondary" className="text-[10px]">{ci.sourceType === "ncert" ? "NCERT" : ci.sourceType === "ai_generated" ? "AI" : ci.sourceType}</Badge>
                        {ci.qualityScore ? <Badge variant="outline" className="text-[10px]">{Math.round(parseFloat(ci.qualityScore) * 100)}%</Badge> : null}
                      </div>
                      <ContentViewToggle content={{ id: ci.id, title: ci.title, body: ci.body, contentType: ci.contentType, sourceType: ci.sourceType, sourceUrl: (ci as Record<string, unknown>).sourceUrl as string | undefined, metadata: ci.metadata ?? null }} syncKey={topicId} onAskAI={(question) => { if (question) setChatInput(question); setRightPanel("chat"); }} />
                    </div>
                  ))}
                  {/* Videos section */}
                  {videos.length > 0 && (
                    <div className="mt-6">
                      <h3 className="text-sm font-semibold mb-3 flex items-center gap-1.5"><Video className="h-4 w-4 text-red-600" /> My Videos</h3>
                      <div className="grid gap-3 sm:grid-cols-2">
                        {videos.map((v) => {
                          const videoId = v.youtubeUrl.match(/(?:v=|youtu\.be\/|\/live\/|\/shorts\/|\/embed\/)([a-zA-Z0-9_-]{11})/)?.[1];
                          return (
                            <div key={v.id} className="relative rounded-lg overflow-hidden border">
                              {videoId && <div className="relative w-full" style={{ paddingBottom: "56.25%" }}><iframe src={`https://www.youtube.com/embed/${videoId}`} className="absolute inset-0 w-full h-full" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen /></div>}
                              <div className="flex items-center justify-between px-2 py-1 bg-muted/50">
                                <span className="text-[10px] truncate">{v.title ?? v.youtubeUrl}</span>
                                <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={() => deleteVideo(v.id)}><Trash2 className="h-3 w-3 text-muted-foreground" /></Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {/* Mark complete */}
                  <div className="flex items-center justify-center py-4">
                    <Button onClick={markComplete} variant="outline" className="gap-2">
                      <CheckCircle2 className="h-4 w-4" />
                      {data.progress?.completionPercent === 100 ? "Completed!" : "Mark as Complete"}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center py-20 text-center">
                  <Sparkles className="h-10 w-10 text-primary/40 mb-4" />
                  <p className="font-medium">Content being prepared</p>
                  <p className="text-sm text-muted-foreground mt-1">Study notes for this topic are being generated.</p>
                </div>
              )}

              {/* Related topics */}
              {data.relatedTopics.length > 0 && (
                <div className="mt-6 rounded-lg border p-3">
                  <h3 className="text-xs font-semibold mb-2">Related Topics</h3>
                  <div className="flex flex-wrap gap-1.5">
                    {data.relatedTopics.map((rt) => (
                      <Link key={rt.id} href={`/dashboard/learn/${rt.id}`}><Badge variant="outline" className="cursor-pointer hover:bg-muted text-[10px]">{rt.title}</Badge></Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>

          {/* ======= SELECTION TOOLTIP ======= */}
          {selectionPos && (
            <div ref={tooltipRef}
              className="fixed z-50 flex items-center gap-1.5 rounded-lg border bg-card shadow-xl p-1.5"
              style={{ left: Math.max(10, Math.min(selectionPos.x - 140, window.innerWidth - 300)), top: Math.max(10, selectionPos.y - 48) }}
              onMouseDown={(e) => e.preventDefault()} /* Prevent mousedown from clearing selection */
            >
              {/* Highlight colors */}
              {(["red", "orange", "green"] as const).map((c) => (
                <button key={c}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => highlightText(c)}
                  title={c === "red" ? "Tough — need to revise" : c === "orange" ? "Almost OK — review once more" : "Understood — got it!"}
                  className={`h-7 w-7 rounded-full border-2 border-white shadow-sm hover:scale-110 transition-transform ${c === "red" ? "bg-red-500" : c === "orange" ? "bg-orange-500" : "bg-green-500"}`}
                />
              ))}
              <Separator orientation="vertical" className="h-6 mx-0.5" />
              {/* Copy */}
              <Button variant="ghost" size="sm" className="h-7 text-[10px] px-2 gap-1"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { navigator.clipboard.writeText(selectionPos.text); setSelectionPos(null); }}>
                <Copy className="h-3 w-3" />Copy
              </Button>
              {/* Ask AI */}
              <Button variant="ghost" size="sm" className="h-7 text-[10px] px-2 gap-1 text-violet-600"
                onMouseDown={(e) => e.preventDefault()}
                onClick={askAiWithSelection}>
                <Sparkles className="h-3 w-3" />Ask AI
              </Button>
              {/* Close */}
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { setSelectionPos(null); window.getSelection()?.removeAllRanges(); }}>
                <X className="h-3 w-3" />
              </Button>
            </div>
          )}

          {/* ======= RIGHT PANEL (resizable + overlay) ======= */}
          {rightPanel && (
            <aside className={`shrink-0 flex flex-col border-l bg-card transition-all duration-200 overflow-hidden min-w-0 ${
              panelSize === "overlay" ? "fixed right-0 top-0 bottom-0 z-50 w-[600px] max-w-[90vw] shadow-2xl" :
              panelSize === "wide" ? "w-[480px] max-w-[50vw]" : "w-80 max-w-[85vw]"
            }`}>
              {/* Panel overlay backdrop */}
              {panelSize === "overlay" && <div className="fixed inset-0 bg-black/30 z-[-1]" onClick={() => setPanelSize("normal")} />}
              <div className="flex items-center justify-between border-b px-3 py-1.5 shrink-0">
                <span className="text-xs font-semibold capitalize">{rightPanel === "pyqs" ? "Previous Year Questions" : rightPanel === "chat" ? "AI Tutor" : rightPanel}</span>
                <div className="flex items-center gap-0.5">
                  {/* Resize buttons */}
                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0" title="Normal size" onClick={() => setPanelSize("normal")}
                    style={{ opacity: panelSize === "normal" ? 1 : 0.4 }}><Minimize2 className="h-3 w-3" /></Button>
                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0" title="Wide" onClick={() => setPanelSize("wide")}
                    style={{ opacity: panelSize === "wide" ? 1 : 0.4 }}><Maximize2 className="h-3 w-3" /></Button>
                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0" title="Overlay" onClick={() => setPanelSize(panelSize === "overlay" ? "normal" : "overlay")}
                    style={{ opacity: panelSize === "overlay" ? 1 : 0.4 }}><Layers className="h-3 w-3" /></Button>
                  <Separator orientation="vertical" className="h-4 mx-0.5" />
                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => { setRightPanel(null); setPanelSize("normal"); }}><X className="h-3 w-3" /></Button>
                </div>
              </div>

              {/* ---- AI Chat Panel ---- */}
              {rightPanel === "chat" && (
                <>
                  {/* Provider selector */}
                  <div className="flex items-center gap-1 px-3 py-1.5 border-b">
                    {(["claude", "gemini", "openai", "mistral", "sarvam"] as const).map((p) => (
                      <button key={p} onClick={() => setChatProvider(p)}
                        className={`rounded px-2 py-0.5 text-[10px] font-medium transition-colors ${chatProvider === p ? "bg-violet-600 text-white" : "bg-muted text-muted-foreground hover:text-foreground"}`}>
                        {p === "claude" ? "Claude" : p === "gemini" ? "Gemini" : p === "openai" ? "GPT" : p === "mistral" ? "Mistral" : "Sarvam"}
                      </button>
                    ))}
                  </div>
                  <ScrollArea className="flex-1 p-3">
                    <div className="space-y-3">
                      {chatMessages.length === 0 && (
                        <div className="text-center py-8">
                          <Sparkles className="mx-auto h-8 w-8 text-violet-500/50 mb-2" />
                          <p className="text-[10px] text-muted-foreground">Ask anything about <strong>{topic.title}</strong></p>
                          <p className="text-[9px] text-muted-foreground mt-1">Select text in the content and click &quot;Ask AI&quot; for context-aware help</p>
                        </div>
                      )}
                      {chatMessages.map((msg, i) => (
                        <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                          <div className={`max-w-[85%] rounded-lg px-3 py-2 text-xs ${msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                            {msg.role === "assistant" ? <MarkdownRenderer content={msg.content} className="text-xs" /> : msg.content}
                          </div>
                        </div>
                      ))}
                      {chatSending && <div className="flex justify-start"><div className="bg-muted rounded-lg px-3 py-2"><Loader2 className="h-4 w-4 animate-spin" /></div></div>}
                      <div ref={chatEndRef} />
                    </div>
                  </ScrollArea>
                  {chatSuggestions.length > 0 && (
                    <div className="px-3 py-1 border-t">
                      <div className="flex flex-wrap gap-1">{chatSuggestions.map((s, i) => (
                        <button key={i} onClick={() => sendChat(s)} className="rounded-full border px-2 py-0.5 text-[9px] text-muted-foreground hover:bg-muted">{s}</button>
                      ))}</div>
                    </div>
                  )}
                  <div className="border-t p-2">
                    <form onSubmit={(e) => { e.preventDefault(); sendChat(); }} className="flex gap-1.5">
                      <Input value={chatInput} onChange={(e) => setChatInput(e.target.value)} placeholder="Ask about this topic..." className="h-8 text-xs" disabled={chatSending} />
                      <Button type="submit" size="sm" className="h-8 w-8 p-0 shrink-0" disabled={chatSending || !chatInput.trim()}><Send className="h-3.5 w-3.5" /></Button>
                    </form>
                  </div>
                </>
              )}

              {/* ---- Notes Panel (with camera upload) ---- */}
              {rightPanel === "notes" && (
                <>
                  <div className="p-3 border-b space-y-1.5">
                    <textarea value={newNote} onChange={(e) => setNewNote(e.target.value)} placeholder="Write your notes, observations..." className="w-full rounded-md border bg-background px-3 py-2 text-xs min-h-[60px] resize-none" />
                    <div className="flex gap-1.5">
                      <Button size="sm" className="h-7 text-xs flex-1" onClick={addNote} disabled={!newNote.trim()}><Plus className="mr-1 h-3 w-3" />Add Note</Button>
                      {/* Camera / photo upload for handwritten notes */}
                      <input ref={imageInputRef} type="file" accept="image/*" capture="environment" onChange={handleImageUpload} className="hidden" />
                      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => imageInputRef.current?.click()} disabled={uploadingImage}>
                        {uploadingImage ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Camera className="h-3 w-3 mr-1" />}
                        {uploadingImage ? "Processing..." : "Photo"}
                      </Button>
                    </div>
                  </div>
                  <ScrollArea className="flex-1 p-3">
                    {notes.length === 0 ? (
                      <p className="text-center text-[10px] text-muted-foreground py-8">No notes yet. Type above or take a photo of handwritten notes.</p>
                    ) : (
                      <div className="space-y-2">
                        {notes.map((n) => (
                          <div key={n.id} className="rounded-lg border p-2.5">
                            {/* Handwritten note — show image thumbnail */}
                            {n.imageUrl && (
                              <div className="mb-2">
                                <img src={n.imageUrl} alt="Handwritten note" className="w-full rounded border max-h-32 object-cover cursor-pointer" onClick={() => window.open(n.imageUrl!, "_blank")} />
                                <Badge variant="secondary" className="text-[8px] mt-1">Handwritten</Badge>
                              </div>
                            )}
                            <div className="flex items-start justify-between">
                              <p className="text-xs whitespace-pre-wrap line-clamp-4">{n.body}</p>
                              <Button variant="ghost" size="sm" className="h-5 w-5 p-0 shrink-0 ml-1" onClick={() => deleteNote(n.id)}><Trash2 className="h-3 w-3 text-muted-foreground" /></Button>
                            </div>
                            <div className="text-[9px] text-muted-foreground mt-1">{new Date(n.createdAt).toLocaleDateString()}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </ScrollArea>
                </>
              )}

              {/* ---- Exercises Panel ---- */}
              {rightPanel === "exercises" && (
                <ScrollArea className="flex-1 p-3">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-medium">Self Test — {exercises.length} questions</span>
                    <Button variant="outline" size="sm" className="h-6 text-[10px]" onClick={loadExercises}><Play className="mr-1 h-3 w-3" />New Set</Button>
                  </div>
                  {exercises.length === 0 ? (
                    <div className="text-center py-8">
                      <Play className="mx-auto h-8 w-8 text-muted-foreground/50 mb-2" />
                      <p className="text-[10px] text-muted-foreground">{questionCount > 0 ? "Click 'New Set' to start" : "No questions available for this topic"}</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {exercises.map((q, i) => (
                        <QuestionCard key={q.id} q={q} index={i} revealed={exerciseRevealed.has(q.id)} onReveal={() => setExerciseRevealed((prev) => new Set([...prev, q.id]))} />
                      ))}
                    </div>
                  )}
                </ScrollArea>
              )}

              {/* ---- PYQ Panel ---- */}
              {rightPanel === "pyqs" && (
                <ScrollArea className="flex-1 p-3">
                  <div className="mb-3"><span className="text-xs font-medium">{pyqs.length} Previous Year Questions</span></div>
                  {pyqs.length === 0 ? (
                    <div className="text-center py-8"><p className="text-[10px] text-muted-foreground">No previous year questions found for this topic</p></div>
                  ) : (
                    <div className="space-y-3">
                      {pyqs.map((q, i) => (
                        <QuestionCard key={q.id} q={q} index={i} revealed={pyqRevealed.has(q.id)} onReveal={() => setPyqRevealed((prev) => new Set([...prev, q.id]))} showYear />
                      ))}
                    </div>
                  )}
                </ScrollArea>
              )}

              {/* ---- Videos Panel (with Suggest Videos) ---- */}
              {rightPanel === "videos" && (
                <>
                  <div className="p-3 border-b space-y-1.5">
                    <div className="flex gap-1.5">
                      <Input value={newVideoUrl} onChange={(e) => setNewVideoUrl(e.target.value)} placeholder="Paste YouTube URL..." className="h-8 text-xs" />
                      <Button size="sm" className="h-8 px-2 shrink-0" onClick={addVideo} disabled={!newVideoUrl.trim()}><Plus className="h-3.5 w-3.5" /></Button>
                    </div>
                    <div className="flex gap-1.5">
                      <Input value={suggestQuery} onChange={(e) => setSuggestQuery(e.target.value)} placeholder="Search videos or click Suggest..." className="h-8 text-xs" />
                      <Button variant="outline" size="sm" className="h-8 text-xs px-2 shrink-0" onClick={() => suggestVideos(suggestQuery || undefined)} disabled={suggestLoading}>
                        {suggestLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3 mr-0.5" />}
                        Suggest
                      </Button>
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto overflow-x-hidden p-3 min-w-0">
                    {/* Suggested videos from YouTube */}
                    {suggestedVideos.length > 0 && (
                      <div className="mb-4">
                        <div className="text-[10px] font-medium text-violet-600 mb-2">Suggested Videos ({suggestedVideos.length})</div>
                        <div className="space-y-2">
                          {suggestedVideos.map((sv) => (
                            <div key={sv.videoId} className="rounded-lg border overflow-hidden">
                              <div className="relative w-full" style={{ paddingBottom: "56.25%" }}><iframe src={`https://www.youtube.com/embed/${sv.videoId}`} className="absolute inset-0 w-full h-full" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen /></div>
                              <div className="px-2 py-1.5">
                                <div className="text-[10px] font-medium line-clamp-2">{sv.title}</div>
                                <div className="flex items-center gap-2 mt-0.5">
                                  <span className="text-[9px] text-muted-foreground">{sv.channelTitle}</span>
                                  <span className="text-[9px] text-muted-foreground">{sv.viewCount >= 1000 ? `${(sv.viewCount / 1000).toFixed(1)}K` : sv.viewCount} views</span>
                                  {sv.duration && <span className="text-[9px] text-muted-foreground">{sv.duration}</span>}
                                </div>
                                <Button size="sm" className="h-6 text-[9px] mt-1 w-full" onClick={() => saveSuggestedVideo(sv)}>
                                  <Plus className="h-3 w-3 mr-0.5" />Save to My Videos
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Saved videos */}
                    {videos.length > 0 && (
                      <div>
                        <div className="text-[10px] font-medium text-muted-foreground mb-2">My Saved Videos ({videos.length})</div>
                        <div className="space-y-2">
                          {videos.map((v) => {
                            const vid = v.youtubeUrl.match(/(?:v=|youtu\.be\/|\/live\/|\/shorts\/|\/embed\/)([a-zA-Z0-9_-]{11})/)?.[1];
                            return (
                              <div key={v.id} className="rounded-lg border overflow-hidden">
                                {vid && <div className="relative w-full" style={{ paddingBottom: "56.25%" }}><iframe src={`https://www.youtube.com/embed/${vid}`} className="absolute inset-0 w-full h-full" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen /></div>}
                                <div className="flex items-center justify-between px-2 py-1">
                                  <span className="text-[10px] truncate">{v.title ?? "Video"}</span>
                                  <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={() => deleteVideo(v.id)}><Trash2 className="h-3 w-3" /></Button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {videos.length === 0 && suggestedVideos.length === 0 && !suggestLoading && (
                      <div className="text-center py-6">
                        <Video className="mx-auto h-8 w-8 text-muted-foreground/30 mb-2" />
                        <p className="text-[10px] text-muted-foreground">Click &quot;Suggest&quot; to find videos for this topic</p>
                      </div>
                    )}
                  </div>
                </>
              )}
              {/* ---- Exam Panel ---- */}
              {rightPanel === "exam" && (
                <ScrollArea className="flex-1">
                  {examState === "idle" && (
                    <div className="p-3 space-y-4">
                      <div className="text-center py-4">
                        <GraduationCap className="mx-auto h-10 w-10 text-violet-500/50 mb-2" />
                        <p className="text-sm font-medium">Self-Test Exam</p>
                        <p className="text-[10px] text-muted-foreground mt-1">Test your knowledge on this topic</p>
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-medium">Questions</label>
                        <div className="flex gap-1.5">
                          {[5, 10, 15].map((n) => (
                            <Button key={n} variant={examQuestionCount === n ? "default" : "outline"} size="sm" className="h-7 text-xs flex-1" onClick={() => setExamQuestionCount(n)}>{n}</Button>
                          ))}
                        </div>
                      </div>
                      <Button className="w-full h-8 text-xs" onClick={startExam} disabled={examLoading}>
                        {examLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Play className="h-3.5 w-3.5 mr-1" />}
                        Start Exam
                      </Button>
                    </div>
                  )}

                  {examState === "taking" && (
                    <div className="p-3 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium">{examQuestions.length} Questions</span>
                        <span className="text-[10px] text-muted-foreground">{examAnswers.size}/{examQuestions.length} answered</span>
                      </div>
                      {examQuestions.map((q, i) => {
                        const answered = examAnswers.get(q.id);
                        return (
                          <div key={q.id} className="rounded-lg border p-2.5">
                            <div className="flex items-center gap-1.5 mb-1.5">
                              <Badge variant={answered ? "default" : "outline"} className="text-[9px]">Q{i + 1}</Badge>
                              <Badge variant="secondary" className="text-[9px]">{q.difficulty}</Badge>
                              <Badge variant="outline" className="text-[9px]">{q.marks}m</Badge>
                            </div>
                            <p className="text-xs leading-relaxed mb-2">{q.question_text}</p>
                            {q.options && Array.isArray(q.options) && (
                              <div className="space-y-1">
                                {(q.options as Array<{ label: string; text: string }>).map((opt) => (
                                  <button key={opt.label} onClick={() => selectExamOption(q.id, opt.label)}
                                    className={`flex items-start gap-1.5 w-full rounded px-2 py-1.5 text-left text-[11px] transition-colors border ${
                                      answered?.includes(opt.label) ? "border-violet-500 bg-violet-50 dark:bg-violet-950/30" : "hover:bg-muted/50"
                                    }`}>
                                    <span className="font-medium shrink-0">{opt.label}.</span>
                                    <span>{opt.text}</span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                      <Button className="w-full h-8 text-xs" onClick={submitExam} disabled={examLoading || examAnswers.size === 0}>
                        {examLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <CheckCircle2 className="h-3.5 w-3.5 mr-1" />}
                        Submit Exam ({examAnswers.size}/{examQuestions.length} answered)
                      </Button>
                    </div>
                  )}

                  {examState === "submitted" && examResult && (
                    <div className="p-3 space-y-3">
                      {/* Score card */}
                      <div className="rounded-lg border p-4 text-center">
                        <div className={`text-3xl font-bold ${examResult.percentage >= 60 ? "text-emerald-600" : examResult.percentage >= 35 ? "text-amber-600" : "text-red-600"}`}>
                          {examResult.percentage}%
                        </div>
                        <div className="text-lg font-medium">Grade: {examResult.grade}</div>
                        <div className="text-xs text-muted-foreground">{examResult.totalScore}/{examResult.maxScore} marks</div>
                      </div>
                      {/* Per-question review */}
                      {examResult.responses.map((r, i) => {
                        const q = examQuestions.find((eq) => eq.id === r.questionId);
                        return (
                          <div key={r.questionId} className={`rounded-lg border p-2.5 ${r.isCorrect === true ? "border-emerald-300 bg-emerald-50/50 dark:bg-emerald-950/20" : r.isCorrect === false ? "border-red-300 bg-red-50/50 dark:bg-red-950/20" : ""}`}>
                            <div className="flex items-center gap-1.5 mb-1">
                              <Badge variant="outline" className="text-[9px]">Q{i + 1}</Badge>
                              {r.isCorrect === true && <Badge className="text-[9px] bg-emerald-600">Correct</Badge>}
                              {r.isCorrect === false && <Badge className="text-[9px] bg-red-600">Incorrect</Badge>}
                              <span className="text-[9px] text-muted-foreground ml-auto">{r.marksObtained}/{q?.marks ?? "?"}m</span>
                            </div>
                            <p className="text-[11px] mb-1">{q?.question_text}</p>
                            {r.userAnswer && <div className="text-[10px] mb-1"><strong>Your answer:</strong> {r.userAnswer}</div>}
                            {r.correctAnswer && <div className="text-[10px] text-emerald-700 dark:text-emerald-400"><strong>Correct:</strong> {r.correctAnswer}</div>}
                            {r.solution && <div className="text-[10px] text-blue-700 dark:text-blue-400 mt-1"><strong>Solution:</strong> {r.solution}</div>}
                          </div>
                        );
                      })}
                      <Button variant="outline" className="w-full h-8 text-xs" onClick={() => { setExamState("idle"); setExamResult(null); }}>
                        <Play className="h-3 w-3 mr-1" />Take Another Exam
                      </Button>
                    </div>
                  )}
                </ScrollArea>
              )}
            </aside>
          )}
        </div>

        {/* Bottom nav */}
        <div className="flex items-center justify-between border-t px-4 py-1.5 shrink-0 bg-card">
          {navigation.prev ? (
            <Link href={`/dashboard/learn/${navigation.prev.id}`}><Button variant="ghost" size="sm" className="h-7 text-xs"><ChevronLeft className="mr-1 h-3.5 w-3.5" /><span className="hidden sm:inline truncate max-w-[150px]">{navigation.prev.title}</span><span className="sm:hidden">Prev</span></Button></Link>
          ) : <div />}
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-20 rounded-full bg-muted overflow-hidden"><div className="h-full rounded-full bg-violet-600 transition-all" style={{ width: `${data.progress?.completionPercent ?? 0}%` }} /></div>
            <span className="text-[10px] text-muted-foreground">{data.progress?.completionPercent ?? 0}%</span>
          </div>
          {navigation.next ? (
            <Link href={`/dashboard/learn/${navigation.next.id}`}><Button variant="ghost" size="sm" className="h-7 text-xs"><span className="hidden sm:inline truncate max-w-[150px]">{navigation.next.title}</span><span className="sm:hidden">Next</span><ChevronRight className="ml-1 h-3.5 w-3.5" /></Button></Link>
          ) : <div />}
        </div>
      </main>

      {/* Foundation Builder Popup — fullscreen overlay with native scroll */}
      {foundationOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" onClick={() => setFoundationOpen(false)}>
          <div
            className="absolute inset-4 sm:inset-8 lg:inset-y-8 lg:inset-x-[10%] rounded-xl bg-background border shadow-2xl flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Sticky header */}
            <div className="flex items-center justify-between gap-3 border-b px-6 py-4 shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-violet-100 dark:bg-violet-900/30">
                  <Layers className="h-5 w-5 text-violet-600" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold truncate">
                    {foundationContent?.title ?? "Foundations"}
                  </h2>
                  <div className="flex items-center gap-2 mt-0.5">
                    {foundationContent?.prerequisiteCount ? (
                      <Badge variant="secondary" className="text-xs">
                        {foundationContent.prerequisiteCount} prerequisites
                      </Badge>
                    ) : null}
                    {foundationContent?.cached && (
                      <Badge variant="outline" className="text-xs">Shared Content</Badge>
                    )}
                    <span className="text-xs text-muted-foreground">Saved to Study Journal</span>
                  </div>
                </div>
              </div>
              <Button variant="ghost" size="icon" className="shrink-0" onClick={() => setFoundationOpen(false)}>
                <X className="h-5 w-5" />
              </Button>
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto px-6 py-6">
              {foundationContent?.body && (
                <div className="mx-auto max-w-3xl">
                  <MarkdownRenderer
                    content={foundationContent.body}
                    className="prose-sm max-w-none"
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Question Card — reused for exercises and PYQs
// ---------------------------------------------------------------------------

function QuestionCard({ q, index, revealed, onReveal, showYear }: { q: Question; index: number; revealed: boolean; onReveal: () => void; showYear?: boolean }) {
  return (
    <div className="rounded-lg border p-2.5">
      <div className="flex items-center gap-1.5 mb-1.5">
        <Badge variant="outline" className="text-[9px]">Q{index + 1}</Badge>
        <Badge variant="secondary" className="text-[9px]">{q.difficulty}</Badge>
        <Badge variant="outline" className="text-[9px]">{q.marks}m</Badge>
        {showYear && q.source_year && <Badge variant="outline" className="text-[9px]">{q.source_year}</Badge>}
      </div>
      <p className="text-xs leading-relaxed mb-2">{q.question_text}</p>
      {/* MCQ options */}
      {q.options && Array.isArray(q.options) && (
        <div className="space-y-1 mb-2">
          {(q.options as Array<{ label: string; text: string; isCorrect: boolean }>).map((opt) => (
            <div key={opt.label} className={`flex items-start gap-1.5 rounded px-2 py-1 text-[11px] ${revealed && opt.isCorrect ? "bg-emerald-50 dark:bg-emerald-950/30 font-medium text-emerald-700 dark:text-emerald-300" : ""}`}>
              <span className="font-medium shrink-0">{opt.label}.</span>
              <span>{opt.text}</span>
              {revealed && opt.isCorrect && <CheckCircle2 className="h-3 w-3 text-emerald-600 shrink-0 mt-0.5" />}
            </div>
          ))}
        </div>
      )}
      {!revealed ? (
        <Button variant="outline" size="sm" className="h-6 text-[10px] w-full" onClick={onReveal}>Show Answer</Button>
      ) : (
        <div className="space-y-1.5">
          {q.correct_answer && <div className="rounded bg-emerald-50 dark:bg-emerald-950/30 px-2 py-1 text-[10px]"><strong>Answer:</strong> {q.correct_answer}</div>}
          {q.solution && <div className="rounded bg-blue-50 dark:bg-blue-950/30 px-2 py-1 text-[10px]"><strong>Solution:</strong> {q.solution}</div>}
        </div>
      )}
    </div>
  );
}
