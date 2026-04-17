"use client";

import { useEffect, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { MarkdownRenderer } from "@/components/content/markdown-renderer";
import {
  Loader2, Send, CheckCircle, Sparkles, ArrowLeft, Paperclip,
  Image as ImageIcon, FileText, X, Camera, Mic, Square,
} from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import { uploadToStorage, generateStorageKey } from "@/lib/s3";

interface ChatMessage {
  id: number | string;
  type: "question" | "response";
  senderId: number;
  senderName: string;
  senderAvatar: string | null;
  text: string;
  isAi: boolean;
  isStudent: boolean; // true if sent by the student who asked
  mediaUrl?: string | null;
  responseType?: string;
  createdAt: string;
}

interface DoubtDetail {
  id: number; studentId: number; studentName: string; studentAvatar: string | null;
  questionText: string; questionImages: string[]; status: string;
  createdAt: string; metadata?: Record<string, unknown>;
  responses: Array<{
    id: number; responderId: number; responderName: string; responderAvatar: string | null;
    responseText: string; responseType: string; mediaUrl: string | null; isAi: boolean; createdAt: string;
  }>;
}

export default function DoubtChatPage() {
  const params = useParams();
  const router = useRouter();
  const [doubt, setDoubt] = useState<DoubtDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [attachFile, setAttachFile] = useState<File | null>(null);
  const [attachPreview, setAttachPreview] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { fetchDoubt(); }, [params.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [doubt?.responses.length]);

  async function fetchDoubt() {
    const res = await fetch(`/api/doubts/${params.id}`);
    const data = await res.json();
    if (data.success) setDoubt(data.data);
    setLoading(false);
  }

  // Build chat messages from doubt + responses
  function buildMessages(): ChatMessage[] {
    if (!doubt) return [];
    const msgs: ChatMessage[] = [];

    // Original question — include attached images
    const qImages = Array.isArray(doubt.questionImages) ? doubt.questionImages as string[] : [];
    const firstImage = qImages.find(img => typeof img === "string" && img.startsWith("/") || img.startsWith("http"));
    msgs.push({
      id: `q-${doubt.id}`,
      type: "question",
      senderId: doubt.studentId,
      senderName: doubt.studentName,
      senderAvatar: doubt.studentAvatar,
      text: doubt.questionText,
      isAi: false,
      isStudent: true,
      mediaUrl: firstImage || null,
      responseType: firstImage ? "image" : undefined,
      createdAt: doubt.createdAt,
    });

    // Responses
    for (const r of doubt.responses) {
      msgs.push({
        id: r.id,
        type: "response",
        senderId: r.responderId,
        senderName: r.isAi ? "AI Assistant" : r.responderName,
        senderAvatar: r.isAi ? null : r.responderAvatar,
        text: r.responseText,
        isAi: r.isAi,
        isStudent: r.responderId === doubt.studentId,
        mediaUrl: r.mediaUrl,
        responseType: r.responseType,
        createdAt: r.createdAt,
      });
    }

    return msgs;
  }

  async function handleSend() {
    if (!message.trim() && !attachFile) return;
    setSending(true);

    let mediaUrl: string | undefined;
    let responseType = "text";

    // Upload attachment if any
    if (attachFile) {
      try {
        const fd = new FormData();
        fd.append("file", attachFile);
        const uploadRes = await fetch("/api/doubts/upload", { method: "POST", body: fd });
        const uploadData = await uploadRes.json();
        if (uploadData.success) {
          mediaUrl = uploadData.data.url;
          responseType = uploadData.data.mediaType;
        }
      } catch { /* upload failed — send text only */ }
    }

    // Build description for attachment if no text
    let text = message;
    if (!text.trim() && mediaUrl) {
      const typeLabel = responseType === "image" ? "Image" : responseType === "audio" ? "Voice note" : responseType === "video" ? "Video" : "File";
      text = `📎 ${typeLabel} attached`;
    }

    const res = await fetch(`/api/doubts/${params.id}/respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ responseText: text, responseType, mediaUrl }),
    });

    const data = await res.json();
    setSending(false);

    if (data.success) {
      setMessage("");
      setAttachFile(null);
      setAttachPreview(null);
      fetchDoubt();
    } else {
      toast.error(data.error?.message || "Failed to send");
    }
  }

  async function askAiNow() {
    setSending(true);
    try {
      const res = await fetch(`/api/doubts/${params.id}/ask-ai`, { method: "POST" });
      const data = await res.json();
      if (data.success) {
        toast.success("AI response generated!");
      } else {
        toast.error(data.error?.message || "AI generation failed");
      }
    } catch { /* ignore */ }
    setSending(false);
    fetchDoubt();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAttachFile(file);
    if (file.type.startsWith("image/")) {
      setAttachPreview(URL.createObjectURL(file));
    } else {
      setAttachPreview(null);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removeAttachment() {
    if (attachPreview) URL.revokeObjectURL(attachPreview);
    setAttachFile(null);
    setAttachPreview(null);
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        const file = new File([blob], `voice-${Date.now()}.webm`, { type: "audio/webm" });
        setAttachFile(file);
        setAttachPreview(null); // audio has no image preview
        stream.getTracks().forEach(t => t.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);
      recordingTimerRef.current = setInterval(() => setRecordingTime(t => t + 1), 1000);
    } catch {
      toast.error("Microphone access denied. Please allow microphone in browser settings.");
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  }

  function cancelRecording() {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
    setAttachFile(null);
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    audioChunksRef.current = [];
  }

  function formatRecordTime(secs: number): string {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
  if (!doubt) return <p className="text-muted-foreground py-10 text-center">Doubt not found.</p>;

  const messages = buildMessages();
  const contextText = (doubt.metadata as Record<string, unknown>)?.contextText as string | undefined;
  const isClosed = doubt.status === "closed";

  return (
    <div className="flex flex-col h-[calc(100vh-120px)] max-w-3xl">
      {/* Chat header */}
      <div className="flex items-center gap-3 pb-3 border-b shrink-0">
        <Button variant="ghost" size="icon" onClick={() => router.back()}><ArrowLeft className="h-4 w-4" /></Button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{doubt.questionText.substring(0, 60)}...</p>
          <div className="flex items-center gap-2">
            <Badge
              variant={doubt.status === "closed" ? "secondary" : doubt.status.includes("answered") ? "default" : "destructive"}
              className="text-[10px] py-0 h-4"
            >
              {doubt.status === "ai_answered" ? "AI Answered"
                : doubt.status === "open" ? "Waiting for teacher"
                : doubt.status === "creator_answered" ? "Teacher Answered"
                : doubt.status}
            </Badge>
            <span className="text-[10px] text-muted-foreground">{new Date(doubt.createdAt).toLocaleDateString()}</span>
          </div>
        </div>
        {!isClosed && (
          <Button variant="outline" size="sm" className="text-xs gap-1" onClick={() => {
            fetch(`/api/doubts/${params.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "closed" }) })
              .then(() => { toast.success("Doubt closed"); fetchDoubt(); });
          }}>
            <CheckCircle className="h-3 w-3" />Resolve
          </Button>
        )}
      </div>

      {/* Context quote (if text was selected from content) */}
      {contextText && (
        <div className="mx-4 mt-3 rounded-lg border-l-4 border-violet-400 bg-violet-50 dark:bg-violet-950/20 p-3">
          <p className="text-[10px] font-medium text-violet-600 uppercase tracking-wider mb-1">Selected from content</p>
          <p className="text-xs italic text-muted-foreground line-clamp-3">&ldquo;{contextText}&rdquo;</p>
        </div>
      )}

      {/* Chat messages */}
      <div className="flex-1 overflow-y-auto px-2 py-4 space-y-3">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.isStudent ? "justify-end" : "justify-start"} gap-2`}
          >
            {/* Left avatar (for non-student messages) */}
            {!msg.isStudent && (
              <Avatar className="h-7 w-7 shrink-0 mt-1">
                {msg.isAi ? (
                  <AvatarFallback className="bg-violet-100 text-violet-600 text-[10px]"><Sparkles className="h-3.5 w-3.5" /></AvatarFallback>
                ) : (
                  <>
                    <AvatarImage src={msg.senderAvatar || undefined} />
                    <AvatarFallback className="text-[10px]">{msg.senderName?.[0] || "T"}</AvatarFallback>
                  </>
                )}
              </Avatar>
            )}

            {/* Message bubble */}
            <div className={`max-w-[75%] ${msg.isStudent ? "order-first" : ""}`}>
              {/* Sender name (for non-student) */}
              {!msg.isStudent && (
                <div className="flex items-center gap-1.5 mb-0.5 px-1">
                  <span className="text-[10px] font-medium text-muted-foreground">{msg.senderName}</span>
                  {msg.isAi && <Sparkles className="h-2.5 w-2.5 text-violet-500" />}
                </div>
              )}

              <div
                className={`rounded-2xl px-4 py-2.5 text-sm ${
                  msg.isStudent
                    ? "bg-violet-600 text-white rounded-br-md"
                    : msg.isAi
                    ? "bg-violet-50 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-800 rounded-bl-md"
                    : "bg-muted rounded-bl-md"
                }`}
              >
                {/* Media preview — show for any mediaUrl */}
                {msg.mediaUrl && (
                  <div className="mb-2">
                    {(msg.responseType === "image" || msg.mediaUrl.match(/\.(jpg|jpeg|png|webp|gif)$/i)) && (
                      <img src={msg.mediaUrl} alt="" className="rounded-lg max-h-48 cursor-pointer" onClick={() => window.open(msg.mediaUrl!, "_blank")} />
                    )}
                    {(msg.responseType === "audio" || msg.mediaUrl.match(/\.(mp3|wav|ogg|webm|m4a)$/i)) && (
                      <audio src={msg.mediaUrl} controls className="w-full" />
                    )}
                    {(msg.responseType === "video" || msg.mediaUrl.match(/\.(mp4|mov|webm)$/i)) && (
                      <video src={msg.mediaUrl} controls className="w-full rounded-lg" />
                    )}
                    {msg.responseType === "document" && (
                      <a href={msg.mediaUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 p-2 rounded bg-black/10 hover:bg-black/20">
                        <FileText className="h-4 w-4" /><span className="text-xs underline">Open document</span>
                      </a>
                    )}
                  </div>
                )}

                {/* Text content — render markdown for AI, plain for others */}
                {msg.isAi ? (
                  <div className="prose prose-sm max-w-none dark:prose-invert prose-p:my-1 prose-headings:my-2">
                    <MarkdownRenderer content={msg.text} />
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap">{msg.text}</p>
                )}
              </div>

              <p className={`text-[9px] text-muted-foreground mt-0.5 ${msg.isStudent ? "text-right" : "text-left"} px-1 flex items-center gap-1 ${msg.isStudent ? "justify-end" : ""}`}>
                {new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                {msg.type === "response" && !msg.isStudent && (
                  <span className={`text-[8px] px-1 py-0.5 rounded ${msg.isAi ? "bg-violet-100 text-violet-600 dark:bg-violet-900/30" : "bg-blue-100 text-blue-600 dark:bg-blue-900/30"}`}>
                    {msg.isAi ? "✨ AI" : "👨‍🏫 Teacher"}
                  </span>
                )}
              </p>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Attachment preview */}
      {attachFile && (
        <div className="mx-2 mb-1 p-2 rounded-lg border bg-muted/50 flex items-center gap-2">
          {attachPreview ? (
            <img src={attachPreview} alt="" className="h-12 w-12 rounded object-cover" />
          ) : attachFile.type.startsWith("audio/") ? (
            <div className="flex items-center gap-2">
              <Mic className="h-5 w-5 text-red-500" />
              <audio src={URL.createObjectURL(attachFile)} controls className="h-8" />
            </div>
          ) : (
            <FileText className="h-8 w-8 text-muted-foreground" />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium truncate">{attachFile.name}</p>
            <p className="text-[10px] text-muted-foreground">{(attachFile.size / 1024).toFixed(0)} KB</p>
          </div>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={removeAttachment}><X className="h-3 w-3" /></Button>
        </div>
      )}

      {/* Ask AI button — shown when doubt is waiting for teacher but student wants AI help */}
      {!isClosed && doubt.status === "open" && !doubt.responses.some(r => r.isAi) && (
        <div className="px-3 py-2 border-t bg-violet-50 dark:bg-violet-950/10">
          <Button variant="outline" size="sm" className="w-full gap-1.5 text-xs" disabled={sending} onClick={askAiNow}>
            {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 text-violet-500" />}
            Get instant AI answer while waiting for teacher
          </Button>
        </div>
      )}

      {/* Input area — WhatsApp style with camera + mic */}
      {!isClosed ? (
        <div className="border-t bg-background shrink-0">
          {/* Recording indicator */}
          {isRecording && (
            <div className="flex items-center gap-3 px-4 py-2 bg-red-50 dark:bg-red-950/20 border-b">
              <div className="h-3 w-3 rounded-full bg-red-500 animate-pulse" />
              <span className="text-sm text-red-600 dark:text-red-400 font-medium flex-1">Recording... {formatRecordTime(recordingTime)}</span>
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={cancelRecording}>Cancel</Button>
              <Button size="sm" className="h-7 text-xs gap-1 bg-red-500 hover:bg-red-600" onClick={stopRecording}>
                <Square className="h-3 w-3" />Stop
              </Button>
            </div>
          )}

          <div className="flex items-end gap-1 p-2">
            {/* Attachment (files) */}
            <input ref={fileInputRef} type="file" className="hidden" accept="image/*,audio/*,video/*,.pdf,.docx" onChange={handleFileSelect} />
            <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" title="Attach file" onClick={() => fileInputRef.current?.click()}>
              <Paperclip className="h-4 w-4 text-muted-foreground" />
            </Button>

            {/* Camera (opens camera on mobile, file picker on desktop) */}
            <input ref={cameraInputRef} type="file" className="hidden" accept="image/*" capture="environment" onChange={handleFileSelect} />
            <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" title="Take photo" onClick={() => cameraInputRef.current?.click()}>
              <Camera className="h-4 w-4 text-muted-foreground" />
            </Button>

            {/* Text input */}
            <textarea
              ref={textareaRef}
              className="flex-1 min-h-[36px] max-h-[120px] rounded-2xl border bg-muted/50 px-4 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type your message..."
              rows={1}
            />

            {/* Mic (voice recording) or Send */}
            {!message.trim() && !attachFile ? (
              <Button
                variant="ghost"
                size="icon"
                className={`h-9 w-9 rounded-full shrink-0 ${isRecording ? "text-red-500" : ""}`}
                title={isRecording ? "Stop recording" : "Record voice note"}
                onClick={isRecording ? stopRecording : startRecording}
              >
                <Mic className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                size="icon"
                className="h-9 w-9 rounded-full shrink-0"
                disabled={sending || (!message.trim() && !attachFile)}
                onClick={handleSend}
              >
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="p-3 border-t text-center text-sm text-muted-foreground bg-muted/30">
          <CheckCircle className="h-4 w-4 inline mr-1 text-green-500" />
          This doubt has been resolved
        </div>
      )}
    </div>
  );
}
