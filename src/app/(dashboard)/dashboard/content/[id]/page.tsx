"use client";

import { useEffect, useState, useRef } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MarkdownRenderer } from "@/components/content/markdown-renderer";
import { OcrBlockRenderer } from "@/components/content/ocr-block-renderer";
import { ImageLightbox } from "@/components/content/image-lightbox";
import { type OcrBlock } from "@/lib/content-pipeline/ocr-blocks";
import { useViewTracking } from "@/hooks/use-view-tracking";
import {
  Loader2, ArrowLeft, Eye, FileText, FileVideo, FileAudio,
  Image as ImageIcon, BookOpen, Download, HelpCircle, Send, X,
  Paperclip, Camera, Mic, Square, Sparkles, MessageCircle, ZoomIn,
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
  metadata?: Record<string, unknown> | null;
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
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

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
        <div
          className="rounded-lg border overflow-hidden flex justify-center bg-muted/10 p-4 cursor-pointer group relative"
          onClick={() => setLightboxIndex(0)}
        >
          <img src={content.mediaUrl} alt={content.title} className="max-h-[600px] rounded object-contain" />
          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/20 rounded">
            <ZoomIn className="h-10 w-10 text-white drop-shadow-lg" />
          </div>
        </div>
      )}

      {/* Handwritten notes: show all source images (stored in metadata.mediaItems) */}
      {content.contentType !== "image" && (() => {
        const meta = (content.metadata as Record<string, unknown> | null) ?? {};
        const mediaItems = (meta.mediaItems as Array<{ type: string; url: string; fileName?: string }> | undefined) ?? [];
        const images = mediaItems.filter((m) => m.type === "image");
        if (images.length === 0) return null;
        return (
          <div className="space-y-3">
            {images.length > 1 && <p className="text-xs font-medium text-muted-foreground">Source images ({images.length})</p>}
            <div className={images.length === 1 ? "rounded-lg border overflow-hidden flex justify-center bg-muted/10 p-4" : "grid gap-3 sm:grid-cols-2"}>
              {images.map((img, i) => (
                <div
                  key={i}
                  className="rounded-lg border overflow-hidden flex justify-center bg-muted/10 p-3 cursor-pointer group relative"
                  onClick={() => setLightboxIndex(i)}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.url}
                    alt={img.fileName || `Page ${i + 1}`}
                    className="max-h-[500px] rounded object-contain"
                  />
                  <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/20 rounded">
                    <ZoomIn className="h-10 w-10 text-white drop-shadow-lg" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

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

      {/* Text/Note body — prefer structured OCR blocks when available for cleaner rendering */}
      {(() => {
        const meta = (content.metadata as Record<string, unknown> | null) ?? {};
        const ocrBlockGroups = meta.ocrBlocks as OcrBlock[][] | undefined;
        // Flatten per-image block arrays into a single list
        const allBlocks = ocrBlockGroups?.flat() as OcrBlock[] | undefined;

        if (allBlocks && allBlocks.length > 0) {
          return (
            <Card>
              <CardContent className="py-6">
                <OcrBlockRenderer blocks={allBlocks} />
              </CardContent>
            </Card>
          );
        }
        if (content.body) {
          return (
            <Card>
              <CardContent className="py-6">
                <MarkdownRenderer content={content.body} />
              </CardContent>
            </Card>
          );
        }
        return null;
      })()}

      {/* Tags */}
      {content.aiTags && content.aiTags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {content.aiTags.map(tag => (
            <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>
          ))}
        </div>
      )}

      {/* Floating Ask Doubt CTA */}
      <FloatingDoubtCTA contentId={Number(params.id)} classroomId={classroomId} content={content} />

      {/* Fullscreen image lightbox */}
      {lightboxIndex !== null && (() => {
        const meta = (content.metadata as Record<string, unknown> | null) ?? {};
        const mediaItems = (meta.mediaItems as Array<{ type: string; url: string }> | undefined) ?? [];
        const images = mediaItems.filter((m) => m.type === "image").map((m) => m.url);
        // Fall back to content.mediaUrl for single-image content
        const urls = images.length > 0 ? images : (content.mediaUrl ? [content.mediaUrl] : []);
        if (urls.length === 0) return null;
        return (
          <ImageLightbox
            images={urls}
            initialIndex={lightboxIndex}
            onClose={() => setLightboxIndex(null)}
          />
        );
      })()}
    </div>
  );
}

// ── Floating Doubt CTA with full chat, audio recording, camera ──
function FloatingDoubtCTA({ contentId, classroomId, content }: { contentId: number; classroomId?: number; content: ContentDetail }) {
  const router = useRouter();
  const [selectedText, setSelectedText] = useState("");
  const [showTooltip, setShowTooltip] = useState(false);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [panelOpen, setPanelOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [sending, setSending] = useState(false);
  const [history, setHistory] = useState<Array<{ id: number; questionText: string; status: string; createdAt: string }>>([]);
  const [answerMode, setAnswerMode] = useState<"ai" | "creator">("ai");
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [attachFile, setAttachFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Build content context
  const contentContext = [content.boardName, content.subjectName, content.chapterTitle, content.topicTitle].filter(Boolean).join(" › ");

  // Listen for text selection
  useEffect(() => {
    function handleSelection() {
      const selection = window.getSelection();
      const text = selection?.toString().trim() || "";
      if (text.length > 5 && !panelOpen) {
        setSelectedText(text);
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
  }, [panelOpen]);

  // Load doubt history for this content when panel opens
  useEffect(() => {
    if (panelOpen) {
      fetch(`/api/doubts?mine=true&limit=5`)
        .then(r => r.json())
        .then(res => { if (res.success) setHistory(res.data.items || []); })
        .catch(() => {});
    }
  }, [panelOpen]);

  function openPanel(withSelection = false) {
    if (withSelection && selectedText) {
      setQuestion(`I have a doubt about: "${selectedText.substring(0, 200)}"`);
    } else {
      setQuestion("");
    }
    setPanelOpen(true);
    setShowTooltip(false);
  }

  async function handleSend() {
    if (!question.trim() && !attachFile) return;
    setSending(true);

    // Upload attachment first
    let uploadedUrl: string | undefined;
    if (attachFile) {
      try {
        const fd = new FormData();
        fd.append("file", attachFile);
        const upRes = await fetch("/api/doubts/upload", { method: "POST", body: fd });
        const upData = await upRes.json();
        if (upData.success) uploadedUrl = upData.data.url;
      } catch { /* ignore */ }
    }

    const typeLabel = attachFile?.type.startsWith("image/") ? "Image"
      : attachFile?.type.startsWith("audio/") ? "Voice note"
      : attachFile?.type.startsWith("video/") ? "Video" : "File";

    const body: Record<string, unknown> = {
      questionText: question || (uploadedUrl ? `📎 ${typeLabel} about: ${content.title}` : ""),
      contentId,
      classroomId: classroomId || undefined,
      contextType: selectedText ? "text_selection" : undefined,
      contextText: selectedText || undefined,
      answerMode,
      questionImages: uploadedUrl ? [uploadedUrl] : undefined,
    };

    const res = await fetch("/api/doubts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    setSending(false);

    if (data.success) {
      toast.success(answerMode === "ai" ? "AI is generating a response..." : "Sent to your teacher!");
      router.push(`/dashboard/doubts/${data.data.id}`);
    } else {
      toast.error(data.error?.message || "Failed");
    }
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: "audio/webm" });
      mediaRecorderRef.current = mr;
      audioChunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mr.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        setAttachFile(new File([blob], `voice-${Date.now()}.webm`, { type: "audio/webm" }));
        stream.getTracks().forEach(t => t.stop());
      };
      mr.start();
      setIsRecording(true);
      setRecordingTime(0);
      timerRef.current = setInterval(() => setRecordingTime(t => t + 1), 1000);
    } catch { toast.error("Microphone access denied"); }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) setAttachFile(file);
    if (e.target === fileRef.current && fileRef.current) fileRef.current.value = "";
    if (e.target === cameraRef.current && cameraRef.current) cameraRef.current.value = "";
  }

  return (
    <>
      {/* Text selection tooltip */}
      {showTooltip && (
        <div className="fixed z-50 -translate-x-1/2 -translate-y-full" style={{ left: tooltipPos.x, top: tooltipPos.y }}>
          <Button size="sm" className="gap-1.5 shadow-lg rounded-full" onClick={() => openPanel(true)}>
            <HelpCircle className="h-3.5 w-3.5" />Ask about this
          </Button>
        </div>
      )}

      {/* Floating FAB */}
      {!panelOpen && (
        <button onClick={() => openPanel(false)} className="fixed bottom-20 right-6 z-40 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-xl flex items-center justify-center hover:scale-105 transition-transform">
          <HelpCircle className="h-6 w-6" />
        </button>
      )}

      {/* Slide-up chat panel */}
      {panelOpen && (
        <div className="fixed bottom-0 left-0 right-0 z-50 bg-background border-t shadow-2xl rounded-t-2xl max-w-3xl mx-auto flex flex-col max-h-[60vh]">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <HelpCircle className="h-4 w-4 text-primary" />Ask a Doubt
              </h3>
              <p className="text-[10px] text-muted-foreground truncate">
                {content.title} {contentContext ? `· ${contentContext}` : ""}
              </p>
            </div>
            {/* AI / Creator toggle */}
            <div className="flex items-center gap-1 mr-2">
              <Button variant={answerMode === "ai" ? "default" : "outline"} size="sm" className="h-7 text-[10px] gap-1 px-2" onClick={() => setAnswerMode("ai")}>
                <Sparkles className="h-3 w-3" />AI
              </Button>
              <Button variant={answerMode === "creator" ? "default" : "outline"} size="sm" className="h-7 text-[10px] gap-1 px-2" onClick={() => setAnswerMode("creator")}>
                <MessageCircle className="h-3 w-3" />Teacher
              </Button>
            </div>
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => setPanelOpen(false)}><X className="h-4 w-4" /></Button>
          </div>

          {/* Recent doubt history */}
          {history.length > 0 && (
            <div className="px-4 py-2 border-b overflow-x-auto shrink-0">
              <p className="text-[10px] text-muted-foreground mb-1">Recent doubts</p>
              <div className="flex gap-2">
                {history.map(d => (
                  <Link key={d.id} href={`/dashboard/doubts/${d.id}`}>
                    <div className="rounded-lg border bg-muted/50 px-3 py-1.5 text-[10px] whitespace-nowrap hover:bg-muted cursor-pointer min-w-[120px]">
                      <p className="truncate font-medium max-w-[150px]">{d.questionText.substring(0, 40)}...</p>
                      <p className="text-muted-foreground">{d.status} · {new Date(d.createdAt).toLocaleDateString()}</p>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Context quote */}
          {selectedText && (
            <div className="mx-4 mt-2 rounded-lg border-l-4 border-violet-400 bg-violet-50 dark:bg-violet-950/20 p-2">
              <p className="text-[10px] text-violet-600 font-medium uppercase">Selected text</p>
              <p className="text-xs italic line-clamp-2">&ldquo;{selectedText.substring(0, 200)}&rdquo;</p>
            </div>
          )}

          {/* Attachment preview */}
          {attachFile && (
            <div className="mx-4 mt-2 p-2 rounded-lg border bg-muted/50 flex items-center gap-2">
              {attachFile.type.startsWith("image/") ? (
                <img src={URL.createObjectURL(attachFile)} alt="" className="h-10 w-10 rounded object-cover" />
              ) : attachFile.type.startsWith("audio/") ? (
                <Mic className="h-5 w-5 text-red-500" />
              ) : (
                <FileText className="h-5 w-5 text-muted-foreground" />
              )}
              <span className="text-xs truncate flex-1">{attachFile.name}</span>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setAttachFile(null)}><X className="h-3 w-3" /></Button>
            </div>
          )}

          {/* Recording indicator */}
          {isRecording && (
            <div className="mx-4 mt-2 flex items-center gap-2 text-xs text-red-600">
              <div className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
              Recording {Math.floor(recordingTime / 60)}:{(recordingTime % 60).toString().padStart(2, "0")}
              <Button variant="ghost" size="sm" className="h-6 text-[10px] ml-auto" onClick={stopRecording}>
                <Square className="h-3 w-3 mr-1" />Stop
              </Button>
            </div>
          )}

          {/* Input bar */}
          <div className="flex items-end gap-1 p-3 shrink-0">
            <input ref={fileRef} type="file" className="hidden" accept="image/*,audio/*,video/*,.pdf,.docx" onChange={handleFileSelect} />
            <input ref={cameraRef} type="file" className="hidden" accept="image/*" capture="environment" onChange={handleFileSelect} />

            <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => fileRef.current?.click()}>
              <Paperclip className="h-4 w-4 text-muted-foreground" />
            </Button>
            <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => cameraRef.current?.click()}>
              <Camera className="h-4 w-4 text-muted-foreground" />
            </Button>

            <textarea
              className="flex-1 min-h-[36px] max-h-[80px] rounded-2xl border bg-muted/50 px-4 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              placeholder={answerMode === "ai" ? "Ask AI..." : "Ask your teacher..."}
              autoFocus
            />

            {!question.trim() && !attachFile ? (
              <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full shrink-0" onClick={isRecording ? stopRecording : startRecording}>
                <Mic className={`h-4 w-4 ${isRecording ? "text-red-500" : "text-muted-foreground"}`} />
              </Button>
            ) : (
              <Button size="icon" className="h-9 w-9 rounded-full shrink-0" disabled={sending} onClick={handleSend}>
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
