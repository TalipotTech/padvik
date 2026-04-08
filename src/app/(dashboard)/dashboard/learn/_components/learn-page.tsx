"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  BookOpen, GraduationCap, Search, CheckCircle2, Award, BarChart3,
  Layers, ChevronRight, Play, Circle, StickyNote,
  MessageSquare, Video, Highlighter, Clock,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MarkdownRenderer } from "@/components/content/markdown-renderer";
import { useBoardSelection } from "@/hooks/use-board-selection";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SubjectProgress {
  subject_id: number; subject_name: string; subject_code: string;
  chapter_count: number; topic_count: number; content_count: number;
  avg_completion: number; latest_topic_id: number | null;
  latest_topic_title: string | null; latest_chapter_title: string | null;
  latest_read_at: string | null;
  understanding_counts: { red: number; orange: number; green: number } | null;
}

interface ActivityItem { type: string; topic_id: number; topic_title: string; subject_name: string; chapter_title: string; preview: string; created_at: string }
interface VideoItem { id: number; topic_id: number; youtube_url: string; title: string | null; thumbnail_url: string | null; topic_title: string; subject_name: string; chapter_title: string; created_at: string }
interface NoteItem { id: number; topic_id: number; title: string | null; body: string; topic_title: string; subject_name: string; chapter_title: string; created_at: string }
interface ChatMessage { role: string; content: string; timestamp: string }
interface ChatItem { id: number; topic_id: number; keyword: string | null; message_count: number; ai_provider: string | null; topic_title: string; subject_name: string; chapter_title: string; updated_at: string; messages: ChatMessage[] }
interface ExamHistoryItem { attempt_id: number; title: string; total_score: string | null; max_score: string | null; percentage: string | null; grade: string | null; status: string; submitted_at: string | null; topic_title: string; subject_name: string; topic_id: number }

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function LearnPage() {
  const { boardId, boardName, grade } = useBoardSelection();
  const [subjects, setSubjects] = useState<SubjectProgress[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [chats, setChats] = useState<ChatItem[]>([]);
  const [examHistory, setExamHistory] = useState<ExamHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    if (!boardId || !grade) { setLoading(false); return; }
    setLoading(true);
    fetch(`/api/learn/dashboard?boardId=${boardId}&grade=${grade}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.success) {
          setSubjects(json.data.subjects);
          setActivity(json.data.recentActivity ?? []);
          setVideos(json.data.recentVideos ?? []);
          setNotes(json.data.recentNotes ?? []);
          setChats(json.data.recentChats ?? []);
          setExamHistory(json.data.recentExams ?? []);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [boardId, grade]);

  // Popup preview state
  const [previewNote, setPreviewNote] = useState<NoteItem | null>(null);
  const [previewChat, setPreviewChat] = useState<ChatItem | null>(null);
  const [previewVideo, setPreviewVideo] = useState<VideoItem | null>(null);
  const [previewExam, setPreviewExam] = useState<ExamHistoryItem | null>(null);

  // Compute exam scoring stats
  const examsTaken = examHistory.filter((e) => e.status === "submitted");
  const avgExamScore = examsTaken.length > 0 ? Math.round(examsTaken.reduce((s, e) => s + parseFloat(e.percentage ?? "0"), 0) / examsTaken.length) : 0;
  const bestExamScore = examsTaken.length > 0 ? Math.round(Math.max(...examsTaken.map((e) => parseFloat(e.percentage ?? "0")))) : 0;

  const filtered = searchQuery.trim()
    ? subjects.filter((s) => s.subject_name.toLowerCase().includes(searchQuery.toLowerCase()) || s.subject_code.toLowerCase().includes(searchQuery.toLowerCase()))
    : subjects;

  const inProgress = filtered.filter((s) => s.avg_completion > 0 && s.avg_completion < 100);
  const completed = filtered.filter((s) => s.avg_completion >= 100);
  const notStarted = filtered.filter((s) => s.avg_completion === 0);
  const totalTopics = subjects.reduce((s, sub) => s + sub.topic_count, 0);
  const avgCompletion = subjects.length > 0 ? Math.round(subjects.reduce((s, sub) => s + sub.avg_completion, 0) / subjects.length) : 0;

  if (!boardId || !grade) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <GraduationCap className="h-12 w-12 text-muted-foreground/50 mb-4" />
        <h2 className="text-lg font-semibold">No board selected</h2>
        <Button asChild className="mt-4"><Link href="/dashboard">Go to Dashboard</Link></Button>
      </div>
    );
  }

  return (
    <div className="space-y-5 pt-2">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">My Learning</h1>
          <p className="text-sm text-muted-foreground">{boardName} · Class {grade} · {subjects.length} subjects · {totalTopics} topics · {avgCompletion}% overall</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input placeholder="Search subjects..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="h-9 w-48 pl-8 text-sm" />
          </div>
          <Link href="/dashboard/learn/journal"><Button variant="outline" size="sm" className="h-9 text-xs">Study Journal</Button></Link>
        </div>
      </div>

      {/* Exam scoring summary cards */}
      {examsTaken.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Card><CardContent className="flex items-center gap-3 p-3"><div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-violet-100 text-violet-600"><GraduationCap className="h-4 w-4" /></div><div><p className="text-lg font-bold">{examsTaken.length}</p><p className="text-[10px] text-muted-foreground">Exams Taken</p></div></CardContent></Card>
          <Card><CardContent className="flex items-center gap-3 p-3"><div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${avgExamScore >= 60 ? "bg-emerald-100 text-emerald-600" : "bg-amber-100 text-amber-600"}`}><BarChart3 className="h-4 w-4" /></div><div><p className="text-lg font-bold">{avgExamScore}%</p><p className="text-[10px] text-muted-foreground">Avg Score</p></div></CardContent></Card>
          <Card><CardContent className="flex items-center gap-3 p-3"><div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-emerald-100 text-emerald-600"><Award className="h-4 w-4" /></div><div><p className="text-lg font-bold">{bestExamScore}%</p><p className="text-[10px] text-muted-foreground">Best Score</p></div></CardContent></Card>
          <Card><CardContent className="flex items-center gap-3 p-3"><div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-blue-100 text-blue-600"><StickyNote className="h-4 w-4" /></div><div><p className="text-lg font-bold">{notes.length + chats.length}</p><p className="text-[10px] text-muted-foreground">Notes & Chats</p></div></CardContent></Card>
        </div>
      )}

      {loading ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-lg" />)}</div>
        </div>
      ) : (
        <>
          {/* ===== Recent Activity ===== */}
          {activity.length > 0 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Recent Activity</CardTitle></CardHeader>
              <CardContent className="p-0">
                <div className="divide-y">
                  {activity.map((item, i) => (
                    <Link key={i} href={`/dashboard/learn/${item.topic_id}`}>
                      <div className="flex items-center gap-3 px-4 py-2 hover:bg-muted/50 transition-colors">
                        <ActivityIcon type={item.type} />
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-medium truncate">{item.preview}</div>
                          <div className="text-[10px] text-muted-foreground">{item.subject_name} · {item.topic_title}</div>
                        </div>
                        <div className="text-[10px] text-muted-foreground shrink-0">{timeAgo(item.created_at)}</div>
                        <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
                      </div>
                    </Link>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* ===== Continue Learning + Completed (cards) ===== */}
          {(inProgress.length > 0 || completed.length > 0) && (
            <div className="space-y-3">
              {inProgress.length > 0 && (
                <>
                  <h2 className="text-base font-semibold flex items-center gap-2"><div className="h-2.5 w-2.5 rounded-full bg-amber-500" />Continue Learning</h2>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {inProgress.sort((a, b) => new Date(b.latest_read_at ?? 0).getTime() - new Date(a.latest_read_at ?? 0).getTime()).map((sub) => (
                      <SubjectCard key={sub.subject_id} sub={sub} color="amber" />
                    ))}
                  </div>
                </>
              )}
              {completed.length > 0 && (
                <>
                  <h2 className="text-base font-semibold flex items-center gap-2 mt-4"><div className="h-2.5 w-2.5 rounded-full bg-emerald-500" />Completed</h2>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {completed.map((sub) => <SubjectCard key={sub.subject_id} sub={sub} color="emerald" />)}
                  </div>
                </>
              )}
            </div>
          )}

          {/* ===== My Videos (inline embeds + preview popup) ===== */}
          {videos.length > 0 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Video className="h-4 w-4 text-red-600" />My Videos ({videos.length})</CardTitle></CardHeader>
              <CardContent>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {videos.map((v) => {
                    const vid = v.youtube_url.match(/(?:v=|youtu\.be\/|\/live\/|\/shorts\/|\/embed\/)([a-zA-Z0-9_-]{11})/)?.[1];
                    return (
                      <div key={v.id} className="rounded-lg border overflow-hidden">
                        {vid && (
                          <div className="cursor-pointer" onClick={() => setPreviewVideo(v)}>
                            <img src={`https://img.youtube.com/vi/${vid}/mqdefault.jpg`} alt={v.title ?? "Video"} className="w-full aspect-video object-cover" />
                          </div>
                        )}
                        <div className="px-3 py-2">
                          <div className="text-xs font-medium truncate">{v.title ?? "Video"}</div>
                          <div className="text-[10px] text-muted-foreground">{v.subject_name} · {v.topic_title}</div>
                          <div className="flex items-center justify-between mt-1.5">
                            <span className="text-[9px] text-muted-foreground">{timeAgo(v.created_at)}</span>
                            <Link href={`/dashboard/learn/${v.topic_id}?panel=videos`}>
                              <Button variant="outline" size="sm" className="h-5 text-[9px] px-2"><Play className="h-2.5 w-2.5 mr-0.5" />Playground</Button>
                            </Link>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* ===== My Notes (with preview popup) ===== */}
          {notes.length > 0 && (
            <Card>
              <CardHeader className="pb-2 flex flex-row items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2"><StickyNote className="h-4 w-4 text-blue-600" />My Notes ({notes.length})</CardTitle>
                <Link href="/dashboard/learn/journal?tab=notes"><Button variant="ghost" size="sm" className="h-6 text-[10px]">View All <ChevronRight className="h-3 w-3 ml-0.5" /></Button></Link>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y">
                  {notes.map((n) => (
                    <div key={n.id} className="flex items-start gap-3 px-4 py-2.5 hover:bg-muted/50 transition-colors">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-blue-100 dark:bg-blue-950 text-blue-600 mt-0.5 cursor-pointer" onClick={() => setPreviewNote(n)}><StickyNote className="h-3.5 w-3.5" /></div>
                      <div className="min-w-0 flex-1 cursor-pointer" onClick={() => setPreviewNote(n)}>
                        <div className="text-xs leading-relaxed line-clamp-2">{n.body}</div>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant="secondary" className="text-[9px]">{n.subject_name}</Badge>
                          <span className="text-[9px] text-muted-foreground">{n.chapter_title} · {n.topic_title}</span>
                          <span className="text-[9px] text-muted-foreground ml-auto">{timeAgo(n.created_at)}</span>
                        </div>
                      </div>
                      <Link href={`/dashboard/learn/${n.topic_id}?panel=notes`}>
                        <Button variant="ghost" size="sm" className="h-6 text-[9px] px-2 shrink-0"><Play className="h-2.5 w-2.5 mr-0.5" />Playground</Button>
                      </Link>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* ===== Chat History (with preview popup) ===== */}
          {chats.length > 0 && (
            <Card>
              <CardHeader className="pb-2 flex flex-row items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2"><MessageSquare className="h-4 w-4 text-violet-600" />AI Chat History ({chats.length})</CardTitle>
                <Link href="/dashboard/learn/journal?tab=chats"><Button variant="ghost" size="sm" className="h-6 text-[10px]">View All <ChevronRight className="h-3 w-3 ml-0.5" /></Button></Link>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y">
                  {chats.map((c) => (
                    <div key={c.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/50 transition-colors">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-violet-100 dark:bg-violet-950 text-violet-600 cursor-pointer" onClick={() => setPreviewChat(c)}><MessageSquare className="h-3.5 w-3.5" /></div>
                      <div className="min-w-0 flex-1 cursor-pointer" onClick={() => setPreviewChat(c)}>
                        <div className="text-xs font-medium truncate">{c.keyword ?? "AI Chat"}</div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <Badge variant="secondary" className="text-[9px]">{c.subject_name}</Badge>
                          <span className="text-[9px] text-muted-foreground">{c.topic_title} · {c.message_count} msgs</span>
                          {c.ai_provider && <Badge variant="outline" className="text-[8px]">{c.ai_provider}</Badge>}
                        </div>
                      </div>
                      <div className="text-[10px] text-muted-foreground shrink-0">{timeAgo(c.updated_at)}</div>
                      <Link href={`/dashboard/learn/${c.topic_id}?panel=chat`}>
                        <Button variant="ghost" size="sm" className="h-6 text-[9px] px-2 shrink-0"><Play className="h-2.5 w-2.5 mr-0.5" />Playground</Button>
                      </Link>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* ===== Exam History ===== */}
          {examHistory.length > 0 && (
            <Card>
              <CardHeader className="pb-2 flex flex-row items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2"><GraduationCap className="h-4 w-4 text-violet-600" />Exam History ({examHistory.length})</CardTitle>
                <Link href="/dashboard/learn/journal?tab=exams"><Button variant="ghost" size="sm" className="h-6 text-[10px]">View All <ChevronRight className="h-3 w-3 ml-0.5" /></Button></Link>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y">
                  {examHistory.map((ex) => {
                    const pct = parseFloat(ex.percentage ?? "0");
                    const color = pct >= 60 ? "text-emerald-600" : pct >= 35 ? "text-amber-600" : "text-red-600";
                    const bgColor = pct >= 60 ? "bg-emerald-100 dark:bg-emerald-950" : pct >= 35 ? "bg-amber-100 dark:bg-amber-950" : "bg-red-100 dark:bg-red-950";
                    return (
                      <div key={ex.attempt_id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/50 transition-colors cursor-pointer" onClick={() => setPreviewExam(ex)}>
                        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${bgColor} ${color} font-bold text-sm`}>{ex.grade ?? "?"}</div>
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-medium truncate">{ex.title}</div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <Badge variant="secondary" className="text-[9px]">{ex.subject_name}</Badge>
                            <span className="text-[9px] text-muted-foreground">{ex.topic_title}</span>
                            <span className={`text-[9px] font-medium ${color}`}>{pct}% · {ex.total_score}/{ex.max_score}</span>
                          </div>
                        </div>
                        <div className="text-[10px] text-muted-foreground shrink-0">{ex.submitted_at ? timeAgo(ex.submitted_at) : ex.status}</div>
                        <Link href={`/dashboard/learn/${ex.topic_id}?panel=exam`}>
                          <Button variant="ghost" size="sm" className="h-6 text-[9px] px-2"><Play className="h-2.5 w-2.5 mr-0.5" />Retake</Button>
                        </Link>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* ===== All Subjects (compact grid with status) ===== */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">All Subjects ({filtered.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {filtered.map((sub) => {
                  const status = sub.avg_completion >= 100 ? "completed" : sub.avg_completion > 0 ? "in-progress" : "not-started";
                  const statusColor = status === "completed" ? "bg-emerald-500" : status === "in-progress" ? "bg-amber-500" : "bg-gray-300";
                  const uc = sub.understanding_counts;

                  return (
                    <div key={sub.subject_id} className="flex items-center gap-2.5 rounded-lg border px-3 py-2 hover:bg-muted/30 transition-colors">
                      <div className={`h-2 w-2 rounded-full shrink-0 ${statusColor}`} />
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-medium truncate">{sub.subject_name}</div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="text-[9px] text-muted-foreground">{sub.chapter_count}ch · {sub.topic_count}t</span>
                          {sub.avg_completion > 0 && <span className="text-[9px] font-medium">{sub.avg_completion}%</span>}
                          {uc && uc.green > 0 && <Circle className="h-1.5 w-1.5 fill-emerald-500 text-emerald-500" />}
                          {uc && uc.orange > 0 && <Circle className="h-1.5 w-1.5 fill-orange-500 text-orange-500" />}
                          {uc && uc.red > 0 && <Circle className="h-1.5 w-1.5 fill-red-500 text-red-500" />}
                        </div>
                      </div>
                      {sub.latest_topic_id ? (
                        <Link href={`/dashboard/learn/${sub.latest_topic_id}`}>
                          <Button variant="ghost" size="sm" className="h-6 text-[9px] px-2"><Play className="h-2.5 w-2.5 mr-0.5" />Go</Button>
                        </Link>
                      ) : (
                        <Link href={`/dashboard/syllabus?subjectId=${sub.subject_id}`}>
                          <Button variant="ghost" size="sm" className="h-6 text-[9px] px-2"><BookOpen className="h-2.5 w-2.5 mr-0.5" />Start</Button>
                        </Link>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* ===== POPUP DIALOGS ===== */}

      {/* Video Preview Popup */}
      <Dialog open={!!previewVideo} onOpenChange={(open) => { if (!open) setPreviewVideo(null); }}>
        <DialogContent className="max-w-2xl p-0">
          <DialogHeader className="px-4 py-3 border-b">
            <DialogTitle className="text-sm">{previewVideo?.title ?? "Video"}</DialogTitle>
          </DialogHeader>
          {previewVideo && (() => {
            const vid = previewVideo.youtube_url.match(/(?:v=|youtu\.be\/|\/live\/|\/shorts\/|\/embed\/)([a-zA-Z0-9_-]{11})/)?.[1];
            return (
              <div>
                {vid && <iframe src={`https://www.youtube.com/embed/${vid}?autoplay=1`} className="w-full aspect-video" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />}
                <div className="px-4 py-3 flex items-center justify-between">
                  <div>
                    <div className="text-xs text-muted-foreground">{previewVideo.subject_name} · {previewVideo.chapter_title} · {previewVideo.topic_title}</div>
                    <div className="text-[10px] text-muted-foreground">{timeAgo(previewVideo.created_at)}</div>
                  </div>
                  <Link href={`/dashboard/learn/${previewVideo.topic_id}?panel=videos`}>
                    <Button size="sm" className="h-7 text-xs"><Play className="h-3 w-3 mr-1" />Go to Playground</Button>
                  </Link>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Note Preview Popup */}
      <Dialog open={!!previewNote} onOpenChange={(open) => { if (!open) setPreviewNote(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-sm">Note — {previewNote?.topic_title}</DialogTitle>
          </DialogHeader>
          {previewNote && (
            <div>
              <div className="rounded-lg bg-muted/50 p-4 mb-3">
                <div className="text-sm whitespace-pre-wrap">{previewNote.body}</div>
              </div>
              <div className="flex items-center justify-between">
                <div className="text-[10px] text-muted-foreground">
                  <Badge variant="secondary" className="text-[9px] mr-1">{previewNote.subject_name}</Badge>
                  {previewNote.chapter_title} · {timeAgo(previewNote.created_at)}
                </div>
                <Link href={`/dashboard/learn/${previewNote.topic_id}?panel=notes`}>
                  <Button size="sm" className="h-7 text-xs"><Play className="h-3 w-3 mr-1" />Go to Playground</Button>
                </Link>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Chat Preview Popup — shows full conversation */}
      <Dialog open={!!previewChat} onOpenChange={(open) => { if (!open) setPreviewChat(null); }}>
        <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
          <DialogHeader className="shrink-0">
            <DialogTitle className="text-sm flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-violet-600" />
              {previewChat?.keyword ?? "AI Chat"}
            </DialogTitle>
            <div className="text-[10px] text-muted-foreground">
              {previewChat?.subject_name} · {previewChat?.chapter_title} · {previewChat?.topic_title}
              {previewChat?.ai_provider && <Badge variant="outline" className="text-[8px] ml-1">{previewChat.ai_provider}</Badge>}
              <span className="ml-1">· {previewChat?.message_count} messages · {previewChat ? timeAgo(previewChat.updated_at) : ""}</span>
            </div>
          </DialogHeader>
          {previewChat && (
            <div className="flex-1 overflow-y-auto space-y-3 py-2">
              {(previewChat.messages ?? []).map((msg: ChatMessage, i: number) => (
                <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[85%] rounded-lg px-3 py-2 text-xs ${msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                    {msg.role === "assistant" ? <MarkdownRenderer content={msg.content} className="text-xs" /> : msg.content}
                  </div>
                </div>
              ))}
              {previewChat.messages.length === 0 && (
                <div className="text-center py-4 text-xs text-muted-foreground">No messages in this conversation</div>
              )}
            </div>
          )}
          <div className="flex justify-end shrink-0 pt-2 border-t">
            <Link href={`/dashboard/learn/${previewChat?.topic_id}?panel=chat`}>
              <Button size="sm" className="h-7 text-xs"><MessageSquare className="h-3 w-3 mr-1" />Continue in Playground</Button>
            </Link>
          </div>
        </DialogContent>
      </Dialog>

      {/* Exam Preview Popup */}
      <Dialog open={!!previewExam} onOpenChange={(o) => { if (!o) setPreviewExam(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">{previewExam?.title}</DialogTitle>
            <div className="text-[10px] text-muted-foreground">{previewExam?.subject_name} · {previewExam?.topic_title}</div>
          </DialogHeader>
          {previewExam && (() => {
            const pct = parseFloat(previewExam.percentage ?? "0");
            const color = pct >= 60 ? "text-emerald-600" : pct >= 35 ? "text-amber-600" : "text-red-600";
            return (
              <div className="space-y-3">
                <div className="flex items-center justify-center gap-6 py-3 rounded-lg bg-muted/50">
                  <div className="text-center"><div className={`text-3xl font-bold ${color}`}>{pct}%</div><div className="text-[10px] text-muted-foreground">Score</div></div>
                  <div className="text-center"><div className="text-2xl font-bold">{previewExam.grade}</div><div className="text-[10px] text-muted-foreground">Grade</div></div>
                  <div className="text-center"><div className="text-lg font-medium">{previewExam.total_score}/{previewExam.max_score}</div><div className="text-[10px] text-muted-foreground">Marks</div></div>
                </div>
                <div className="text-xs text-muted-foreground">
                  {previewExam.submitted_at && <div>Submitted: {new Date(previewExam.submitted_at).toLocaleString()}</div>}
                </div>
                <div className="flex gap-2">
                  <Link href={`/dashboard/learn/${previewExam.topic_id}?panel=exam`} className="flex-1"><Button className="w-full h-8 text-xs"><Play className="h-3 w-3 mr-1" />Retake Exam</Button></Link>
                  <Link href={`/dashboard/learn/${previewExam.topic_id}`}><Button variant="outline" className="h-8 text-xs">Study</Button></Link>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SubjectCard({ sub, color }: { sub: SubjectProgress; color: "amber" | "emerald" }) {
  const borderCls = color === "emerald" ? "border-l-emerald-500" : "border-l-amber-500";
  const barCls = color === "emerald" ? "bg-emerald-500" : "bg-violet-600";
  const uc = sub.understanding_counts;

  return (
    <Card className={`h-full border-l-4 ${borderCls}`}>
      <CardHeader className="pb-1.5">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm truncate">{sub.subject_name}</CardTitle>
          <Badge variant="secondary" className="text-[9px] shrink-0">{sub.subject_code}</Badge>
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-2">
        {/* Progress */}
        <div>
          <div className="flex items-center justify-between mb-0.5">
            <span className="text-[9px] text-muted-foreground">{sub.chapter_count} chapters · {sub.topic_count} topics</span>
            <span className="text-[10px] font-medium">{sub.avg_completion}%</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
            <div className={`h-full rounded-full transition-all ${barCls}`} style={{ width: `${sub.avg_completion}%` }} />
          </div>
        </div>
        {/* Understanding */}
        {uc && (uc.red > 0 || uc.orange > 0 || uc.green > 0) && (
          <div className="flex items-center gap-2 text-[9px]">
            {uc.green > 0 && <span className="flex items-center gap-0.5 text-emerald-600"><Circle className="h-1.5 w-1.5 fill-emerald-500 text-emerald-500" />{uc.green}</span>}
            {uc.orange > 0 && <span className="flex items-center gap-0.5 text-orange-600"><Circle className="h-1.5 w-1.5 fill-orange-500 text-orange-500" />{uc.orange}</span>}
            {uc.red > 0 && <span className="flex items-center gap-0.5 text-red-600"><Circle className="h-1.5 w-1.5 fill-red-500 text-red-500" />{uc.red}</span>}
          </div>
        )}
        {/* Last studied */}
        {sub.latest_topic_title && (
          <div className="rounded bg-violet-50 dark:bg-violet-950/20 px-2 py-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[9px] text-violet-600 font-medium">Last studied</span>
              {sub.latest_read_at && <span className="text-[9px] text-muted-foreground">{timeAgo(sub.latest_read_at)}</span>}
            </div>
            <div className="text-[10px] font-medium truncate">{sub.latest_topic_title}</div>
          </div>
        )}
        {/* Actions */}
        <div className="flex gap-2">
          {sub.latest_topic_id ? (
            <Link href={`/dashboard/learn/${sub.latest_topic_id}`}><Button size="sm" className="h-6 text-[10px]"><Play className="h-3 w-3 mr-0.5" />Continue</Button></Link>
          ) : (
            <Link href={`/dashboard/syllabus?subjectId=${sub.subject_id}`}><Button variant="outline" size="sm" className="h-6 text-[10px]"><BookOpen className="h-3 w-3 mr-0.5" />Start</Button></Link>
          )}
          <Link href={`/dashboard/syllabus?subjectId=${sub.subject_id}`}><Button variant="ghost" size="sm" className="h-6 text-[10px]">Study</Button></Link>
        </div>
      </CardContent>
    </Card>
  );
}

function ActivityIcon({ type }: { type: string }) {
  const map: Record<string, { icon: React.ReactNode; cls: string }> = {
    note: { icon: <StickyNote className="h-3 w-3" />, cls: "bg-blue-100 text-blue-600 dark:bg-blue-950 dark:text-blue-400" },
    video: { icon: <Video className="h-3 w-3" />, cls: "bg-red-100 text-red-600 dark:bg-red-950 dark:text-red-400" },
    chat: { icon: <MessageSquare className="h-3 w-3" />, cls: "bg-violet-100 text-violet-600 dark:bg-violet-950 dark:text-violet-400" },
    highlight: { icon: <Highlighter className="h-3 w-3" />, cls: "bg-amber-100 text-amber-600 dark:bg-amber-950 dark:text-amber-400" },
  };
  const item = map[type] ?? map.note;
  return <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${item.cls}`}>{item.icon}</div>;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}
