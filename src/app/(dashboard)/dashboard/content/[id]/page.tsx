"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MarkdownRenderer } from "@/components/content/markdown-renderer";
import { useViewTracking } from "@/hooks/use-view-tracking";
import {
  Loader2, ArrowLeft, Eye, FileText, FileVideo, FileAudio,
  Image as ImageIcon, BookOpen, Download, HelpCircle, Send, X,
} from "lucide-react";
import { toast } from "sonner";

interface ContentDetail {
  id: number; contentType: string; title: string; description: string | null;
  body: string | null; mediaUrl: string | null; thumbnailUrl: string | null;
  viewCount: number; likeCount: number; isPublished: boolean;
  aiSummary: string | null; aiTags: string[] | null;
  boardName: string | null; subjectName: string | null;
  chapterTitle: string | null; topicTitle: string | null;
  createdAt: string;
}

function ContentTypeIcon({ type, className }: { type: string; className?: string }) {
  const cls = className || "h-5 w-5";
  switch (type) {
    case "video": return <FileVideo className={`${cls} text-blue-500`} />;
    case "audio": return <FileAudio className={`${cls} text-green-500`} />;
    case "image": return <ImageIcon className={`${cls} text-amber-500`} />;
    default: return <FileText className={`${cls} text-violet-500`} />;
  }
}

export default function StudentContentViewPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const classroomId = searchParams.get("classroom") ? Number(searchParams.get("classroom")) : undefined;
  const [content, setContent] = useState<ContentDetail | null>(null);
  const [loading, setLoading] = useState(true);

  // View tracking with 30s heartbeat for video/audio
  const { onPlay, onPause, onTimeUpdate, onEnded } = useViewTracking(
    Number(params.id),
    classroomId
  );

  useEffect(() => {
    fetch(`/api/creators/content/${params.id}`)
      .then(r => r.json())
      .then(res => { if (res.success) setContent(res.data); })
      .finally(() => setLoading(false));
  }, [params.id]);

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
  if (!content) return <p className="text-center py-10 text-muted-foreground">Content not found.</p>;

  const curriculum = [content.boardName, content.subjectName, content.chapterTitle, content.topicTitle].filter(Boolean).join(" › ");

  return (
    <div className="max-w-4xl space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => history.back()}><ArrowLeft className="h-4 w-4" /></Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold">{content.title}</h1>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <ContentTypeIcon type={content.contentType} />
            <Badge variant="outline" className="capitalize">{content.contentType}</Badge>
            <span className="text-xs text-muted-foreground"><Eye className="h-3 w-3 inline mr-0.5" />{content.viewCount} views</span>
            <span className="text-xs text-muted-foreground">{new Date(content.createdAt).toLocaleDateString()}</span>
          </div>
          {curriculum && (
            <div className="flex items-center gap-1.5 mt-1">
              <BookOpen className="h-3.5 w-3.5 text-violet-500" />
              <span className="text-sm text-muted-foreground">{curriculum}</span>
            </div>
          )}
        </div>
      </div>

      {/* AI Summary */}
      {content.aiSummary && (
        <div className="rounded-lg border bg-violet-50/50 dark:bg-violet-950/10 p-4">
          <p className="text-xs font-medium text-violet-600 mb-1">AI Summary</p>
          <p className="text-sm">{content.aiSummary}</p>
        </div>
      )}

      {content.description && <p className="text-sm text-muted-foreground">{content.description}</p>}

      {/* Media content */}
      {content.contentType === "video" && content.mediaUrl && (
        <div className="rounded-lg border bg-black overflow-hidden">
          <video
            src={content.mediaUrl}
            controls
            className="w-full aspect-video"
            poster={content.thumbnailUrl || undefined}
            onPlay={onPlay}
            onPause={onPause}
            onTimeUpdate={onTimeUpdate}
            onEnded={onEnded}
          />
        </div>
      )}

      {content.contentType === "audio" && content.mediaUrl && (
        <Card>
          <CardContent className="py-6">
            <audio
              src={content.mediaUrl}
              controls
              className="w-full"
              onPlay={onPlay}
              onPause={onPause}
              onTimeUpdate={onTimeUpdate}
              onEnded={onEnded}
            />
          </CardContent>
        </Card>
      )}

      {content.contentType === "image" && content.mediaUrl && (
        <div className="rounded-lg border overflow-hidden flex justify-center bg-muted/10 p-4">
          <img src={content.mediaUrl} alt={content.title} className="max-h-[600px] rounded object-contain" />
        </div>
      )}

      {content.contentType === "document" && content.mediaUrl && (
        <Card>
          <CardContent className="py-6 flex flex-col items-center gap-3">
            <FileText className="h-12 w-12 text-red-400" />
            <p className="text-sm font-medium">{content.title}</p>
            <a href={content.mediaUrl} target="_blank" rel="noopener noreferrer">
              <Button variant="outline" className="gap-1.5"><Download className="h-4 w-4" />Open Document</Button>
            </a>
          </CardContent>
        </Card>
      )}

      {/* Text/Note body */}
      {content.body && (
        <Card>
          <CardContent className="py-6">
            <MarkdownRenderer content={content.body} />
          </CardContent>
        </Card>
      )}

      {/* Tags */}
      {content.aiTags && content.aiTags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {content.aiTags.map(tag => (
            <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>
          ))}
        </div>
      )}

      {/* Floating Ask Doubt CTA */}
      <FloatingDoubtCTA contentId={Number(params.id)} classroomId={classroomId} />
    </div>
  );
}

// ── Floating Doubt CTA with text selection ──
function FloatingDoubtCTA({ contentId, classroomId }: { contentId: number; classroomId?: number }) {
  const router = useRouter();
  const [selectedText, setSelectedText] = useState("");
  const [showTooltip, setShowTooltip] = useState(false);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [askOpen, setAskOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [sending, setSending] = useState(false);

  // Listen for text selection
  useEffect(() => {
    function handleSelection() {
      const selection = window.getSelection();
      const text = selection?.toString().trim() || "";
      if (text.length > 5) {
        setSelectedText(text);
        // Position tooltip near selection
        const range = selection?.getRangeAt(0);
        if (range) {
          const rect = range.getBoundingClientRect();
          setTooltipPos({ x: rect.left + rect.width / 2, y: rect.top - 10 });
          setShowTooltip(true);
        }
      } else {
        setShowTooltip(false);
      }
    }
    document.addEventListener("mouseup", handleSelection);
    return () => document.removeEventListener("mouseup", handleSelection);
  }, []);

  function askAboutSelection() {
    setQuestion(selectedText ? `I have a doubt about: "${selectedText.substring(0, 200)}"` : "");
    setAskOpen(true);
    setShowTooltip(false);
  }

  async function handleQuickAsk() {
    if (!question.trim()) return;
    setSending(true);
    const res = await fetch("/api/doubts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        questionText: question,
        contentId,
        classroomId: classroomId || undefined,
        contextType: selectedText ? "text_selection" : undefined,
        contextText: selectedText || undefined,
      }),
    });
    const data = await res.json();
    setSending(false);
    if (data.success) {
      toast.success("Doubt posted! AI is generating a response...");
      router.push(`/dashboard/doubts/${data.data.id}`);
    } else {
      toast.error(data.error?.message || "Failed");
    }
  }

  return (
    <>
      {/* Text selection tooltip */}
      {showTooltip && (
        <div
          className="fixed z-50 -translate-x-1/2 -translate-y-full"
          style={{ left: tooltipPos.x, top: tooltipPos.y }}
        >
          <Button
            size="sm"
            className="gap-1.5 shadow-lg rounded-full"
            onClick={askAboutSelection}
          >
            <HelpCircle className="h-3.5 w-3.5" />
            Ask about this
          </Button>
        </div>
      )}

      {/* Floating FAB */}
      {!askOpen && (
        <button
          onClick={() => { setQuestion(""); setAskOpen(true); }}
          className="fixed bottom-20 right-6 z-40 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-xl flex items-center justify-center hover:scale-105 transition-transform"
        >
          <HelpCircle className="h-6 w-6" />
        </button>
      )}

      {/* Slide-up ask panel */}
      {askOpen && (
        <div className="fixed bottom-0 left-0 right-0 z-50 bg-background border-t shadow-2xl rounded-t-2xl p-4 max-w-3xl mx-auto">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <HelpCircle className="h-4 w-4 text-primary" />
              Ask a Doubt
            </h3>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setAskOpen(false)}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          {selectedText && (
            <div className="rounded-lg border-l-4 border-violet-400 bg-violet-50 dark:bg-violet-950/20 p-2 mb-3">
              <p className="text-[10px] text-violet-600 font-medium uppercase">Selected text</p>
              <p className="text-xs italic line-clamp-2">&ldquo;{selectedText.substring(0, 200)}&rdquo;</p>
            </div>
          )}

          <div className="flex gap-2">
            <textarea
              className="flex-1 min-h-[40px] max-h-[100px] rounded-2xl border bg-muted/50 px-4 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleQuickAsk(); } }}
              placeholder="Type your doubt..."
              autoFocus
            />
            <Button
              size="icon"
              className="h-10 w-10 rounded-full shrink-0"
              disabled={sending || !question.trim()}
              onClick={handleQuickAsk}
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
