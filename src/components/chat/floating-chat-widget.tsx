"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Sparkles, X, Send, Loader2, ChevronDown, Plus, Maximize2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { MarkdownRenderer } from "@/components/content/markdown-renderer";
import { useBoardSelection } from "@/hooks/use-board-selection";
import { useActiveTopic } from "@/hooks/use-active-topic";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  provider?: string;
  model?: string;
  suggestions?: string[];
}

// ---------------------------------------------------------------------------
// Floating Chat Widget
// ---------------------------------------------------------------------------

export function FloatingChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [lastProvider, setLastProvider] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { boardName, grade } = useBoardSelection();
  // The topic the student is currently viewing (set by the search page, etc.).
  const activeTopic = useActiveTopic();

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Focus input when opened
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 200);
  }, [open]);

  // Load last conversation when widget first opens
  useEffect(() => {
    if (!open || loaded) return;
    setLoaded(true);

    fetch("/api/chat/general?limit=1")
      .then((r) => r.json())
      .then((json) => {
        if (!json.success || !json.data?.[0]) return;
        const lastConv = json.data[0];
        // Load full conversation detail
        return fetch(`/api/chat/general?id=${lastConv.id}`).then((r) => r.json());
      })
      .then((json) => {
        if (!json?.success || !json.data?.messages) return;
        const msgs = json.data.messages as ChatMessage[];
        if (msgs.length > 0) {
          setMessages(msgs);
          setConversationId(json.data.id);
          setLastProvider(json.data.aiProvider ?? null);
          // Restore suggestions from last assistant message
          const lastAssistant = [...msgs].reverse().find((m) => m.role === "assistant");
          if (lastAssistant?.suggestions) setSuggestions(lastAssistant.suggestions);
        }
      })
      .catch(() => {});
  }, [open, loaded]);

  const sendMessage = useCallback(async (text?: string) => {
    const msg = text ?? input.trim();
    if (!msg || sending) return;

    setSending(true);
    setInput("");
    setSuggestions([]);
    setMessages((prev) => [...prev, { role: "user", content: msg, timestamp: new Date().toISOString() }]);

    try {
      const res = await fetch("/api/chat/general", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: msg,
          conversationId,
          provider: "auto",
          boardCode: boardName,
          grade,
          // Current-topic context — makes answers context-sensitive without
          // touching the visible conversation/history.
          topicId: activeTopic?.topicId ?? null,
          topicTitle: activeTopic?.title ?? null,
          topicSubject: activeTopic?.subject ?? null,
        }),
      });
      const json = await res.json();

      if (json.success) {
        setMessages((prev) => [...prev, {
          role: "assistant",
          content: json.data.message,
          timestamp: new Date().toISOString(),
          provider: json.data.provider,
          model: json.data.model,
          suggestions: json.data.suggestions,
        }]);
        setConversationId(json.data.conversationId);
        setSuggestions(json.data.suggestions ?? []);
        setLastProvider(json.data.provider);
      } else {
        setMessages((prev) => [...prev, {
          role: "assistant",
          content: `Sorry, I encountered an error: ${json.error?.message ?? "Please try again."}`,
          timestamp: new Date().toISOString(),
        }]);
      }
    } catch {
      setMessages((prev) => [...prev, {
        role: "assistant",
        content: "Network error — please check your connection and try again.",
        timestamp: new Date().toISOString(),
      }]);
    } finally {
      setSending(false);
    }
  }, [input, sending, conversationId, boardName, grade, activeTopic]);

  const startNewChat = () => {
    setMessages([]);
    setConversationId(null);
    setSuggestions([]);
    setLastProvider(null);
    setInput("");
  };

  return (
    <>
      {/* Floating bubble */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-violet-600 text-white shadow-lg hover:bg-violet-700 hover:shadow-xl hover:scale-105 transition-all active:scale-95"
          title="Ask AI anything"
        >
          <Sparkles className="h-6 w-6" />
        </button>
      )}

      {/* Chat panel */}
      {open && (
        <div className="fixed bottom-5 right-5 z-50 flex flex-col w-[380px] h-[540px] max-h-[80vh] rounded-2xl bg-background border shadow-2xl overflow-hidden sm:w-[400px]">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-violet-600 text-white shrink-0">
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5" />
              <div className="min-w-0">
                <h3 className="text-sm font-semibold leading-none">Padvik AI</h3>
                <p className="text-[10px] text-violet-200 mt-0.5 truncate max-w-[220px]">
                  {activeTopic
                    ? `Context: ${activeTopic.title}`
                    : lastProvider
                      ? `via ${lastProvider}`
                      : "Ask anything about your studies"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={startNewChat} className="p-1.5 rounded-lg hover:bg-white/20 transition-colors" title="New conversation">
                <Plus className="h-4 w-4" />
              </button>
              <Link href="/dashboard/chat" className="p-1.5 rounded-lg hover:bg-white/20 transition-colors" title="Open full page" onClick={() => setOpen(false)}>
                <Maximize2 className="h-4 w-4" />
              </Link>
              <button onClick={() => setOpen(false)} className="p-1.5 rounded-lg hover:bg-white/20 transition-colors" title="Minimize">
                <ChevronDown className="h-4 w-4" />
              </button>
              <button onClick={() => { setOpen(false); }} className="p-1.5 rounded-lg hover:bg-white/20 transition-colors" title="Close">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <Sparkles className="h-10 w-10 text-violet-300 mb-3" />
                <p className="text-sm font-medium text-foreground">Hi! I&apos;m Padvik AI</p>
                <p className="text-xs text-muted-foreground mt-1 max-w-[250px]">
                  {activeTopic
                    ? `Ask me about ${activeTopic.title} — I have this topic as context.`
                    : "Ask me anything about your studies — Math, Science, Social Studies, or any subject."}
                </p>
                <div className="flex flex-wrap justify-center gap-1.5 mt-4">
                  {(activeTopic
                    ? [`Explain ${activeTopic.title}`, `Give an example of ${activeTopic.title}`, `Quiz me on ${activeTopic.title}`]
                    : ["Explain Pythagoras theorem", "What is photosynthesis?", "Help me with fractions"]
                  ).map((q) => (
                    <button key={q} onClick={() => sendMessage(q)}
                      className="text-[10px] px-2.5 py-1 rounded-full border hover:bg-violet-50 hover:border-violet-300 transition-colors text-muted-foreground">
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={cn("flex flex-col", msg.role === "user" ? "items-end" : "items-start")}>
                <div className={cn(
                  "max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm",
                  msg.role === "user"
                    ? "bg-violet-600 text-white rounded-br-md"
                    : "bg-muted rounded-bl-md"
                )}>
                  {msg.role === "assistant" ? (
                    <MarkdownRenderer content={msg.content} className="[&_p]:text-sm [&_p]:my-1 [&_li]:text-sm [&_h2]:text-sm [&_h3]:text-sm [&_code]:text-xs" />
                  ) : (
                    <p className="leading-relaxed">{msg.content}</p>
                  )}
                </div>
                {/* Provider info for assistant messages */}
                {msg.role === "assistant" && msg.provider && (
                  <span className="text-[9px] text-muted-foreground mt-0.5 px-1">{msg.provider}{msg.model ? ` · ${msg.model.split("-").slice(0, 2).join("-")}` : ""}</span>
                )}
              </div>
            ))}

            {sending && (
              <div className="flex justify-start">
                <div className="bg-muted rounded-2xl rounded-bl-md px-4 py-3">
                  <Loader2 className="h-4 w-4 animate-spin text-violet-500" />
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Suggestions */}
          {suggestions.length > 0 && (
            <div className="flex gap-1.5 px-4 py-1.5 overflow-x-auto border-t bg-muted/30">
              {suggestions.map((s, i) => (
                <button key={i} onClick={() => sendMessage(s)}
                  className="shrink-0 text-[10px] px-2.5 py-1 rounded-full border hover:bg-violet-50 hover:border-violet-300 transition-colors text-muted-foreground">
                  {s}
                </button>
              ))}
            </div>
          )}

          {/* Input */}
          <form onSubmit={(e) => { e.preventDefault(); sendMessage(); }}
            className="flex items-center gap-2 px-3 py-2.5 border-t bg-background shrink-0">
            <input ref={inputRef} type="text" value={input} onChange={(e) => setInput(e.target.value)}
              placeholder="Ask a question..." className="flex-1 text-sm bg-transparent outline-none placeholder:text-muted-foreground/60" disabled={sending} />
            <button type="submit" disabled={!input.trim() || sending}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-600 text-white disabled:opacity-40 hover:bg-violet-700 transition-colors">
              <Send className="h-3.5 w-3.5" />
            </button>
          </form>
        </div>
      )}
    </>
  );
}
