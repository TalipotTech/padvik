"use client";

import { useCallback, useEffect, useState, useRef } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  StickyNote, MessageSquare, GraduationCap, Search, ChevronRight,
  Play, Camera, Loader2, Award, BarChart3, X, ZoomIn, ZoomOut,
  RotateCw, Maximize2, Minimize2, ArrowLeft, Video,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { MarkdownRenderer } from "@/components/content/markdown-renderer";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface NoteItem { id: number; topic_id: number; title: string | null; body: string; note_type: string; image_url: string | null; created_at: string; topic_title: string; chapter_title: string; chapter_number: number; subject_name: string; subject_id: number }
interface ChatMessage { role: string; content: string }
interface ChatItem { id: number; topic_id: number; keyword: string | null; message_count: number; ai_provider: string | null; total_tokens: number; messages: ChatMessage[]; created_at: string; updated_at: string; topic_title: string; chapter_title: string; subject_name: string; subject_id: number }
interface ExamItem { attempt_id: number; exam_id: number; title: string; total_score: string | null; max_score: string | null; percentage: string | null; grade: string | null; status: string; attempt_number: number; started_at: string | null; submitted_at: string | null; topic_id: number; topic_title: string; subject_name: string; subject_id: number; chapter_title: string }
interface ExamSummary { subject_name: string; subject_id: number; exam_count: number; avg_percentage: number; best_percentage: number; total_score_sum: number; max_score_sum: number }
interface VideoItem { id: number; topic_id: number; youtube_url: string; title: string | null; thumbnail_url: string | null; created_at: string; topic_title: string; chapter_title: string; subject_name: string; subject_id: number }

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function JournalPage() {
  const searchParams = useSearchParams();
  const initialTab = searchParams.get("tab") ?? "notes";

  const [activeTab, setActiveTab] = useState(initialTab);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<unknown[]>([]);
  const [total, setTotal] = useState(0);
  const [examSummary, setExamSummary] = useState<ExamSummary[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // Image viewer state
  const [imgZoom, setImgZoom] = useState(1);
  const [imgRotation, setImgRotation] = useState(0);
  const [imgFullscreen, setImgFullscreen] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setSelectedId(null);
    const params = new URLSearchParams({ tab: activeTab, limit: "50" });
    if (searchQuery.trim()) params.set("search", searchQuery.trim());
    try {
      const res = await fetch(`/api/learn/journal?${params}`);
      const json = await res.json();
      if (json.success) {
        setItems(json.data.items);
        setTotal(json.data.total);
        if (json.data.summary) setExamSummary(json.data.summary);
      }
    } catch {} finally { setLoading(false); }
  }, [activeTab, searchQuery]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Highlight search text in content
  function highlightText(text: string, query: string): React.ReactNode {
    if (!query.trim() || query.length < 2) return text;
    const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"));
    return parts.map((part, i) =>
      part.toLowerCase() === query.toLowerCase()
        ? <mark key={i} className="bg-yellow-200 dark:bg-yellow-800 rounded px-0.5">{part}</mark>
        : part
    );
  }

  // Get selected item
  const selectedNote = activeTab === "notes" ? (items as NoteItem[]).find((n) => n.id === selectedId) : null;
  const selectedChat = activeTab === "chats" ? (items as ChatItem[]).find((c) => c.id === selectedId) : null;
  const selectedExam = activeTab === "exams" ? (items as ExamItem[]).find((e) => e.attempt_id === selectedId) : null;
  const selectedVideo = activeTab === "videos" ? (items as VideoItem[]).find((v) => v.id === selectedId) : null;
  const hasSelection = !!(selectedNote || selectedChat || selectedExam || selectedVideo);

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] -mx-4 lg:-mx-6 -my-4 lg:-my-6">
      {/* Top bar */}
      <div className="flex items-center gap-3 border-b px-4 py-2 shrink-0 bg-card">
        <Link href="/dashboard/learn"><Button variant="ghost" size="sm" className="h-7 text-xs"><ArrowLeft className="mr-1 h-3 w-3" />My Learning</Button></Link>
        <Separator orientation="vertical" className="h-5" />
        <h1 className="text-sm font-semibold">Study Journal</h1>
        <div className="flex-1" />
        <span className="text-[10px] text-muted-foreground">{total} items</span>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* ======= LEFT PANEL — List ======= */}
        <div className="w-96 shrink-0 flex flex-col border-r bg-card">
          <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v); setSearchQuery(""); setSelectedId(null); }} className="flex flex-col flex-1">
            <div className="px-3 pt-2 pb-1 space-y-2 shrink-0">
              <TabsList className="w-full">
                <TabsTrigger value="notes" className="flex-1 gap-1 text-xs"><StickyNote className="h-3 w-3" />Notes</TabsTrigger>
                <TabsTrigger value="chats" className="flex-1 gap-1 text-xs"><MessageSquare className="h-3 w-3" />Chats</TabsTrigger>
                <TabsTrigger value="exams" className="flex-1 gap-1 text-xs"><GraduationCap className="h-3 w-3" />Exams</TabsTrigger>
                <TabsTrigger value="videos" className="flex-1 gap-1 text-xs"><Video className="h-3 w-3" />Videos</TabsTrigger>
              </TabsList>
              <div className="relative">
                <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
                <Input placeholder={`Search ${activeTab}...`} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="h-8 pl-8 text-xs" />
              </div>
            </div>

            <ScrollArea className="flex-1">
              {/* Notes list */}
              <TabsContent value="notes" className="m-0 p-0">
                {loading ? <div className="py-8 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto text-violet-600" /></div> : (items as NoteItem[]).length === 0 ? (
                  <div className="py-8 text-center text-xs text-muted-foreground">No notes</div>
                ) : (
                  <div className="divide-y">
                    {(items as NoteItem[]).map((n) => (
                      <button key={n.id} onClick={() => { setSelectedId(n.id); setImgZoom(1); setImgRotation(0); }}
                        className={`flex items-start gap-2.5 w-full px-3 py-2.5 text-left transition-colors ${selectedId === n.id ? "bg-primary/10" : "hover:bg-muted/50"}`}>
                        <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md mt-0.5 ${n.note_type === "handwritten" ? "bg-amber-100 text-amber-600" : "bg-blue-100 text-blue-600"}`}>
                          {n.note_type === "handwritten" ? <Camera className="h-3.5 w-3.5" /> : <StickyNote className="h-3.5 w-3.5" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-[11px] line-clamp-2">{highlightText((n.body ?? "").slice(0, 120), searchQuery)}</div>
                          <div className="flex items-center gap-1.5 mt-1">
                            <Badge variant="secondary" className="text-[8px]">{n.subject_name}</Badge>
                            <span className="text-[9px] text-muted-foreground truncate">{n.topic_title}</span>
                          </div>
                          <div className="text-[9px] text-muted-foreground mt-0.5">{new Date(n.created_at).toLocaleDateString()}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </TabsContent>

              {/* Chats list */}
              <TabsContent value="chats" className="m-0 p-0">
                {loading ? <div className="py-8 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto text-violet-600" /></div> : (items as ChatItem[]).length === 0 ? (
                  <div className="py-8 text-center text-xs text-muted-foreground">No chats</div>
                ) : (
                  <div className="divide-y">
                    {(items as ChatItem[]).map((c) => (
                      <button key={c.id} onClick={() => setSelectedId(c.id)}
                        className={`flex items-center gap-2.5 w-full px-3 py-2.5 text-left transition-colors ${selectedId === c.id ? "bg-primary/10" : "hover:bg-muted/50"}`}>
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-violet-100 text-violet-600"><MessageSquare className="h-3.5 w-3.5" /></div>
                        <div className="min-w-0 flex-1">
                          <div className="text-[11px] font-medium truncate">{highlightText(c.keyword ?? "AI Chat", searchQuery)}</div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <Badge variant="secondary" className="text-[8px]">{c.subject_name}</Badge>
                            <span className="text-[9px] text-muted-foreground">{c.message_count} msgs</span>
                            {c.ai_provider && <Badge variant="outline" className="text-[7px]">{c.ai_provider}</Badge>}
                          </div>
                          <div className="text-[9px] text-muted-foreground mt-0.5">{new Date(c.updated_at).toLocaleDateString()}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </TabsContent>

              {/* Exams list */}
              <TabsContent value="exams" className="m-0 p-0">
                {/* Summary cards */}
                {examSummary.length > 0 && (
                  <div className="p-2 space-y-1.5 border-b">
                    {examSummary.map((s) => (
                      <div key={s.subject_id} className="flex items-center justify-between rounded-md bg-muted/50 px-2.5 py-1.5">
                        <span className="text-[10px] font-medium">{s.subject_name}</span>
                        <div className="flex items-center gap-2 text-[10px]">
                          <span className={s.avg_percentage >= 60 ? "text-emerald-600 font-medium" : "text-amber-600 font-medium"}>Avg {s.avg_percentage}%</span>
                          <span className="text-violet-600 font-medium">Best {s.best_percentage}%</span>
                          <span className="text-muted-foreground">{s.exam_count}x</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {loading ? <div className="py-8 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto text-violet-600" /></div> : (items as ExamItem[]).length === 0 ? (
                  <div className="py-8 text-center text-xs text-muted-foreground">No exams</div>
                ) : (
                  <div className="divide-y">
                    {(items as ExamItem[]).map((ex) => {
                      const pct = parseFloat(ex.percentage ?? "0");
                      const color = pct >= 60 ? "text-emerald-600" : pct >= 35 ? "text-amber-600" : "text-red-600";
                      const bgColor = pct >= 60 ? "bg-emerald-100" : pct >= 35 ? "bg-amber-100" : "bg-red-100";
                      return (
                        <button key={ex.attempt_id} onClick={() => setSelectedId(ex.attempt_id)}
                          className={`flex items-center gap-2.5 w-full px-3 py-2.5 text-left transition-colors ${selectedId === ex.attempt_id ? "bg-primary/10" : "hover:bg-muted/50"}`}>
                          <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${bgColor} ${color} font-bold text-xs`}>{ex.grade ?? "?"}</div>
                          <div className="min-w-0 flex-1">
                            <div className="text-[11px] font-medium truncate">{ex.title}</div>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <Badge variant="secondary" className="text-[8px]">{ex.subject_name}</Badge>
                              <span className={`text-[9px] font-medium ${color}`}>{pct}%</span>
                              <span className="text-[9px] text-muted-foreground">{ex.total_score}/{ex.max_score}</span>
                            </div>
                            <div className="text-[9px] text-muted-foreground mt-0.5">{ex.submitted_at ? new Date(ex.submitted_at).toLocaleDateString() : ex.status}</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="videos" className="m-0 p-0">
                {loading ? <div className="py-8 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto text-violet-600" /></div> : (() => {
                  // Guard: only cast when items actually have youtube_url (videos tab data)
                  const videoItems = (items as VideoItem[]).filter((v) => v && typeof v === "object" && "youtube_url" in v);
                  if (videoItems.length === 0) return <div className="py-8 text-center text-xs text-muted-foreground">No videos saved yet</div>;
                  return (
                  <div className="divide-y">
                    {videoItems.map((v) => {
                      const videoId = v.youtube_url?.match(/(?:v=|youtu\.be\/|\/live\/|\/shorts\/|\/embed\/)([a-zA-Z0-9_-]{11})/)?.[1];
                      return (
                        <button key={v.id} onClick={() => setSelectedId(v.id)}
                          className={`flex items-center gap-2.5 w-full px-3 py-2.5 text-left transition-colors ${selectedId === v.id ? "bg-primary/10" : "hover:bg-muted/50"}`}>
                          {videoId ? (
                            <img src={`https://img.youtube.com/vi/${videoId}/default.jpg`} alt="" className="h-10 w-14 rounded object-cover shrink-0" />
                          ) : (
                            <div className="h-10 w-14 rounded bg-muted flex items-center justify-center shrink-0"><Video className="h-4 w-4 text-muted-foreground" /></div>
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="text-[11px] font-medium truncate">{v.title ?? v.youtube_url}</div>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <Badge variant="secondary" className="text-[8px]">{v.subject_name}</Badge>
                              <span className="text-[9px] text-muted-foreground">{v.topic_title}</span>
                            </div>
                            <div className="text-[9px] text-muted-foreground mt-0.5">{new Date(v.created_at).toLocaleDateString()}</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  );
                })()}
              </TabsContent>
            </ScrollArea>
          </Tabs>
        </div>

        {/* ======= RIGHT PANEL — Detail View ======= */}
        <main className="flex-1 overflow-hidden bg-background">
          <ScrollArea className="h-full">
            {!hasSelection ? (
              <div className="flex flex-col items-center justify-center h-full text-center px-4">
                <StickyNote className="h-12 w-12 text-muted-foreground/20 mb-4" />
                <p className="text-sm font-medium">Select an item</p>
                <p className="text-xs text-muted-foreground mt-1">Click on a note, chat, or exam from the left panel to view details</p>
              </div>
            ) : selectedNote ? (
              /* ===== Note Detail ===== */
              <div className="max-w-3xl mx-auto px-6 py-6">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="secondary" className="text-[10px]">{selectedNote.subject_name}</Badge>
                      <span className="text-[10px] text-muted-foreground">Ch {selectedNote.chapter_number} · {selectedNote.chapter_title}</span>
                    </div>
                    <h2 className="text-lg font-bold">{selectedNote.title ?? selectedNote.topic_title}</h2>
                    <div className="flex items-center gap-2 mt-1">
                      {selectedNote.note_type === "handwritten" && <Badge className="text-[9px] bg-amber-500">Handwritten</Badge>}
                      <span className="text-[10px] text-muted-foreground">{new Date(selectedNote.created_at).toLocaleString()}</span>
                    </div>
                  </div>
                  <Link href={`/dashboard/learn/${selectedNote.topic_id}?panel=notes`}>
                    <Button size="sm" className="h-7 text-xs"><Play className="h-3 w-3 mr-1" />Playground</Button>
                  </Link>
                </div>

                {/* Image viewer for handwritten notes */}
                {selectedNote.image_url && (
                  <div className={`mb-4 rounded-lg border overflow-hidden ${imgFullscreen ? "fixed inset-4 z-50 bg-background" : ""}`}>
                    <div className="flex items-center justify-between bg-muted/50 px-3 py-1.5 border-b">
                      <span className="text-[10px] font-medium">Handwritten Note Image</span>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setImgZoom((z) => Math.max(0.25, z - 0.25))} title="Zoom Out"><ZoomOut className="h-3.5 w-3.5" /></Button>
                        <span className="text-[10px] text-muted-foreground w-10 text-center">{Math.round(imgZoom * 100)}%</span>
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setImgZoom((z) => Math.min(4, z + 0.25))} title="Zoom In"><ZoomIn className="h-3.5 w-3.5" /></Button>
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setImgRotation((r) => (r + 90) % 360)} title="Rotate"><RotateCw className="h-3.5 w-3.5" /></Button>
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => { setImgFullscreen(!imgFullscreen); if (!imgFullscreen) setImgZoom(1); }} title={imgFullscreen ? "Exit Fullscreen" : "Fullscreen"}>
                          {imgFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
                        </Button>
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => { setImgZoom(1); setImgRotation(0); }} title="Reset"><X className="h-3.5 w-3.5" /></Button>
                      </div>
                    </div>
                    <div className={`overflow-auto bg-muted/20 ${imgFullscreen ? "flex-1 h-[calc(100%-36px)]" : "max-h-96"}`}>
                      <div className="flex items-center justify-center min-h-[200px] p-4">
                        <img
                          src={selectedNote.image_url}
                          alt="Handwritten note"
                          className="max-w-none transition-transform duration-200 cursor-grab active:cursor-grabbing"
                          style={{ transform: `scale(${imgZoom}) rotate(${imgRotation}deg)`, transformOrigin: "center center" }}
                          draggable={false}
                        />
                      </div>
                    </div>
                  </div>
                )}

                <Separator className="mb-4" />

                {/* Extracted text / note body */}
                <div className="mb-4">
                  <h3 className="text-sm font-semibold mb-2">{selectedNote.note_type === "handwritten" ? "Extracted Text" : "Note Content"}</h3>
                  <MarkdownRenderer content={selectedNote.body} />
                </div>
              </div>

            ) : selectedChat ? (
              /* ===== Chat Detail ===== */
              <div className="max-w-3xl mx-auto px-6 py-6">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="secondary" className="text-[10px]">{selectedChat.subject_name}</Badge>
                      <span className="text-[10px] text-muted-foreground">{selectedChat.chapter_title} · {selectedChat.topic_title}</span>
                    </div>
                    <h2 className="text-lg font-bold">{selectedChat.keyword ?? "AI Chat"}</h2>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] text-muted-foreground">{selectedChat.message_count} messages</span>
                      {selectedChat.ai_provider && <Badge variant="outline" className="text-[9px]">{selectedChat.ai_provider}</Badge>}
                      <span className="text-[10px] text-muted-foreground">{new Date(selectedChat.updated_at).toLocaleString()}</span>
                    </div>
                  </div>
                  <Link href={`/dashboard/learn/${selectedChat.topic_id}?panel=chat`}>
                    <Button size="sm" className="h-7 text-xs"><MessageSquare className="h-3 w-3 mr-1" />Continue</Button>
                  </Link>
                </div>

                <Separator className="mb-4" />

                <div className="space-y-4">
                  {(selectedChat.messages ?? []).map((msg, i) => (
                    <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[80%] rounded-xl px-4 py-3 ${msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                        {msg.role === "assistant" ? (
                          <MarkdownRenderer content={searchQuery ? msg.content : msg.content} className="text-sm" />
                        ) : (
                          <p className="text-sm">{typeof msg.content === "string" ? highlightText(msg.content, searchQuery) : msg.content}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

            ) : selectedExam ? (
              /* ===== Exam Detail ===== */
              <div className="max-w-3xl mx-auto px-6 py-6">
                {(() => {
                  const pct = parseFloat(selectedExam.percentage ?? "0");
                  const color = pct >= 60 ? "text-emerald-600" : pct >= 35 ? "text-amber-600" : "text-red-600";
                  return (
                    <>
                      <div className="flex items-center justify-between mb-4">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <Badge variant="secondary" className="text-[10px]">{selectedExam.subject_name}</Badge>
                            <span className="text-[10px] text-muted-foreground">{selectedExam.chapter_title} · {selectedExam.topic_title}</span>
                          </div>
                          <h2 className="text-lg font-bold">{selectedExam.title}</h2>
                        </div>
                        <Link href={`/dashboard/learn/${selectedExam.topic_id}?panel=exam`}>
                          <Button size="sm" className="h-7 text-xs"><Play className="h-3 w-3 mr-1" />Retake</Button>
                        </Link>
                      </div>

                      {/* Score card */}
                      <div className="flex items-center justify-center gap-8 py-6 rounded-xl bg-muted/50 mb-4">
                        <div className="text-center">
                          <div className={`text-4xl font-bold ${color}`}>{pct}%</div>
                          <div className="text-xs text-muted-foreground mt-1">Score</div>
                        </div>
                        <div className="text-center">
                          <div className="text-3xl font-bold">{selectedExam.grade}</div>
                          <div className="text-xs text-muted-foreground mt-1">Grade</div>
                        </div>
                        <div className="text-center">
                          <div className="text-xl font-medium">{selectedExam.total_score}/{selectedExam.max_score}</div>
                          <div className="text-xs text-muted-foreground mt-1">Marks</div>
                        </div>
                      </div>

                      <div className="space-y-2 text-sm text-muted-foreground">
                        <div className="flex justify-between"><span>Attempt</span><span>#{selectedExam.attempt_number}</span></div>
                        <div className="flex justify-between"><span>Status</span><span className="capitalize">{selectedExam.status}</span></div>
                        {selectedExam.started_at && <div className="flex justify-between"><span>Started</span><span>{new Date(selectedExam.started_at).toLocaleString()}</span></div>}
                        {selectedExam.submitted_at && <div className="flex justify-between"><span>Submitted</span><span>{new Date(selectedExam.submitted_at).toLocaleString()}</span></div>}
                      </div>

                      <Separator className="my-4" />

                      <div className="flex gap-2">
                        <Link href={`/dashboard/learn/${selectedExam.topic_id}?panel=exam`} className="flex-1">
                          <Button className="w-full h-9"><Play className="h-4 w-4 mr-1" />Retake Exam</Button>
                        </Link>
                        <Link href={`/dashboard/learn/${selectedExam.topic_id}`}>
                          <Button variant="outline" className="h-9">Study Topic</Button>
                        </Link>
                      </div>
                    </>
                  );
                })()}
              </div>
            ) : selectedVideo ? (
              <div className="p-4 space-y-4">
                {(() => {
                  const videoId = selectedVideo.youtube_url.match(/(?:v=|youtu\.be\/|\/live\/|\/shorts\/|\/embed\/)([a-zA-Z0-9_-]{11})/)?.[1];
                  return (
                    <>
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="secondary" className="text-[10px]">{selectedVideo.subject_name}</Badge>
                          <span className="text-[10px] text-muted-foreground">{selectedVideo.chapter_title} &middot; {selectedVideo.topic_title}</span>
                        </div>
                        <h2 className="text-lg font-bold">{selectedVideo.title ?? "Video"}</h2>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-muted-foreground">{new Date(selectedVideo.created_at).toLocaleString()}</span>
                        </div>
                        <Link href={`/dashboard/learn/${selectedVideo.topic_id}?panel=videos`}>
                          <Button variant="link" size="sm" className="text-xs px-0 h-auto">Open in Playground <ChevronRight className="h-3 w-3 ml-0.5" /></Button>
                        </Link>
                      </div>

                      <Separator />

                      {/* Inline YouTube player */}
                      {videoId ? (
                        <div className="rounded-lg overflow-hidden border">
                          <iframe
                            src={`https://www.youtube.com/embed/${videoId}`}
                            className="w-full aspect-video"
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                            allowFullScreen
                          />
                        </div>
                      ) : (
                        <div className="rounded-lg border border-dashed p-8 text-center">
                          <Video className="h-8 w-8 mx-auto text-muted-foreground/40 mb-2" />
                          <p className="text-sm text-muted-foreground">Could not load video</p>
                          <a href={selectedVideo.youtube_url} target="_blank" rel="noopener noreferrer" className="text-xs text-violet-600 hover:underline mt-1 block">Open original link</a>
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            ) : null}
          </ScrollArea>
        </main>
      </div>
    </div>
  );
}
