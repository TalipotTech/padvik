"use client";

import { useEffect, useState, useRef } from "react";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { MarkdownRenderer } from "@/components/content/markdown-renderer";
import {
  Loader2, Send, CheckCircle, Sparkles, ArrowLeft, Paperclip,
  Image as ImageIcon, FileText, X,
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
  const [doubt, setDoubt] = useState<DoubtDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [attachFile, setAttachFile] = useState<File | null>(null);
  const [attachPreview, setAttachPreview] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

    // Original question
    msgs.push({
      id: `q-${doubt.id}`,
      type: "question",
      senderId: doubt.studentId,
      senderName: doubt.studentName,
      senderAvatar: doubt.studentAvatar,
      text: doubt.questionText,
      isAi: false,
      isStudent: true,
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

    // Upload attachment if any
    if (attachFile) {
      try {
        const fd = new FormData();
        fd.append("file", attachFile);
        // Upload via the creator content upload pattern
        const buffer = await attachFile.arrayBuffer();
        const key = `doubts/${params.id}/${Date.now()}-${attachFile.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;

        // Use fetch to upload via a simple endpoint
        const uploadFd = new FormData();
        uploadFd.append("file", attachFile);
        // For now, reference the file directly — in production use S3
        mediaUrl = undefined; // Will be handled when we add file upload to respond API
      } catch { /* ignore upload error */ }
    }

    const res = await fetch(`/api/doubts/${params.id}/respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        responseText: message || (attachFile ? `[Attached: ${attachFile.name}]` : ""),
        responseType: attachFile?.type.startsWith("image/") ? "image"
          : attachFile?.type.startsWith("audio/") ? "audio"
          : attachFile?.type.startsWith("video/") ? "video"
          : "text",
        mediaUrl,
      }),
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

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
  if (!doubt) return <p className="text-muted-foreground py-10 text-center">Doubt not found.</p>;

  const messages = buildMessages();
  const contextText = (doubt.metadata as Record<string, unknown>)?.contextText as string | undefined;
  const isClosed = doubt.status === "closed";

  return (
    <div className="flex flex-col h-[calc(100vh-120px)] max-w-3xl">
      {/* Chat header */}
      <div className="flex items-center gap-3 pb-3 border-b shrink-0">
        <Link href="/dashboard/doubts"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{doubt.questionText.substring(0, 60)}...</p>
          <div className="flex items-center gap-2">
            <Badge
              variant={doubt.status === "closed" ? "secondary" : doubt.status.includes("answered") ? "default" : "destructive"}
              className="text-[10px] py-0 h-4"
            >
              {doubt.status === "ai_answered" ? "AI Answered" : doubt.status}
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
                {/* Media preview */}
                {msg.mediaUrl && msg.responseType === "image" && (
                  <img src={msg.mediaUrl} alt="" className="rounded-lg max-h-48 mb-2" />
                )}
                {msg.mediaUrl && msg.responseType === "audio" && (
                  <audio src={msg.mediaUrl} controls className="w-full mb-2" />
                )}
                {msg.mediaUrl && msg.responseType === "video" && (
                  <video src={msg.mediaUrl} controls className="w-full rounded-lg mb-2" />
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

              <p className={`text-[9px] text-muted-foreground mt-0.5 ${msg.isStudent ? "text-right" : "text-left"} px-1`}>
                {new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
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

      {/* Input area — WhatsApp style */}
      {!isClosed ? (
        <div className="flex items-end gap-2 p-2 border-t bg-background shrink-0">
          <input ref={fileInputRef} type="file" className="hidden" accept="image/*,audio/*,video/*,.pdf,.docx" onChange={handleFileSelect} />
          <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => fileInputRef.current?.click()}>
            <Paperclip className="h-4 w-4 text-muted-foreground" />
          </Button>
          <textarea
            ref={textareaRef}
            className="flex-1 min-h-[36px] max-h-[120px] rounded-2xl border bg-muted/50 px-4 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type your message..."
            rows={1}
          />
          <Button
            size="icon"
            className="h-9 w-9 rounded-full shrink-0"
            disabled={sending || (!message.trim() && !attachFile)}
            onClick={handleSend}
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
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
