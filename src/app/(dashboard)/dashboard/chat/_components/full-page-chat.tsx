"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  Sparkles, Send, Loader2, Plus, Trash2, Clock, MessageSquare,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { MarkdownRenderer } from "@/components/content/markdown-renderer";
import { useBoardSelection } from "@/hooks/use-board-selection";

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

interface ConversationSummary {
  id: number;
  title: string | null;
  messageCount: number;
  aiProvider: string | null;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Full Page Chat — expanded version of the floating widget
// ---------------------------------------------------------------------------

export function FullPageChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [history, setHistory] = useState<ConversationSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { boardName, grade } = useBoardSelection();

  // Load conversation history + auto-load last conversation
  useEffect(() => {
    fetch("/api/chat/general?limit=30")
      .then((r) => r.json())
      .then(async (json) => {
        if (!json.success) return;
        setHistory(json.data);
        // Auto-load the last conversation
        if (json.data.length > 0 && !conversationId) {
          const lastConv = json.data[0];
          const detailRes = await fetch(`/api/chat/general?id=${lastConv.id}`);
          const detail = await detailRes.json();
          if (detail.success && detail.data?.messages) {
            const msgs = detail.data.messages as ChatMessage[];
            setMessages(msgs);
            setConversationId(detail.data.id);
            // Restore suggestions from last assistant message
            const lastAssistant = [...msgs].reverse().find((m: ChatMessage) => m.role === "assistant");
            if (lastAssistant?.suggestions) setSuggestions(lastAssistant.suggestions);
          }
        }
      })
      .catch(() => {})
      .finally(() => setHistoryLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

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
        body: JSON.stringify({ message: msg, conversationId, provider: "auto", boardCode: boardName, grade }),
      });
      const json = await res.json();

      if (json.success) {
        setMessages((prev) => [...prev, { role: "assistant", content: json.data.message, timestamp: new Date().toISOString(), provider: json.data.provider, model: json.data.model, suggestions: json.data.suggestions }]);
        setConversationId(json.data.conversationId);
        setSuggestions(json.data.suggestions ?? []);
      } else {
        setMessages((prev) => [...prev, { role: "assistant", content: `Error: ${json.error?.message ?? "Please try again."}`, timestamp: new Date().toISOString() }]);
      }
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", content: "Network error — please check your connection.", timestamp: new Date().toISOString() }]);
    } finally {
      setSending(false);
    }
  }, [input, sending, conversationId, boardName, grade]);

  const startNewChat = () => {
    setMessages([]);
    setConversationId(null);
    setSuggestions([]);
    setInput("");
    inputRef.current?.focus();
  };

  const loadConversation = async (convId: number) => {
    try {
      const res = await fetch(`/api/chat/general?id=${convId}`);
      const json = await res.json();
      if (json.success && json.data?.messages) {
        const msgs = json.data.messages as ChatMessage[];
        setMessages(msgs);
        setConversationId(json.data.id);
        // Restore suggestions from last assistant message
        const lastAssistant = [...msgs].reverse().find((m) => m.role === "assistant");
        setSuggestions(lastAssistant?.suggestions ?? []);
      }
    } catch {
      // Failed to load — start fresh
      setConversationId(convId);
      setMessages([]);
      setSuggestions([]);
    }
  };

  return (
    <div className="flex h-[calc(100vh-8rem)] -mx-4 lg:-mx-6 -my-4 lg:-my-6">
      {/* Sidebar — conversation history */}
      <div className="hidden md:flex flex-col w-72 border-r bg-muted/30 shrink-0">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h2 className="text-sm font-semibold">Conversations</h2>
          <Button variant="ghost" size="sm" onClick={startNewChat} className="h-7 w-7 p-0">
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        <ScrollArea className="flex-1">
          {historyLoading ? (
            <div className="py-8 text-center"><Loader2 className="h-4 w-4 animate-spin mx-auto text-muted-foreground" /></div>
          ) : history.length === 0 ? (
            <div className="py-8 text-center text-xs text-muted-foreground">No conversations yet</div>
          ) : (
            <div className="divide-y">
              {history.map((conv) => (
                <button
                  key={conv.id}
                  onClick={() => loadConversation(conv.id)}
                  className={cn(
                    "flex flex-col w-full px-4 py-2.5 text-left hover:bg-muted/50 transition-colors",
                    conversationId === conv.id && "bg-primary/10"
                  )}
                >
                  <span className="text-xs font-medium truncate">{conv.title ?? "Untitled"}</span>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[9px] text-muted-foreground">{conv.messageCount} msgs</span>
                    {conv.aiProvider && <Badge variant="outline" className="text-[8px] px-1 py-0">{conv.aiProvider}</Badge>}
                    <span className="text-[9px] text-muted-foreground ml-auto">
                      {new Date(conv.updatedAt).toLocaleDateString()}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* Main chat area */}
      <div className="flex flex-1 flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-violet-600" />
            <div>
              <h1 className="text-sm font-semibold">Padvik AI</h1>
              <p className="text-[10px] text-muted-foreground">Ask anything about your studies</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={startNewChat} className="text-xs gap-1">
            <Plus className="h-3 w-3" /> New Chat
          </Button>
        </div>

        {/* Messages */}
        <ScrollArea className="flex-1 px-4 py-4">
          <div className="max-w-3xl mx-auto space-y-4">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-violet-100 dark:bg-violet-900/30 mb-4">
                  <Sparkles className="h-8 w-8 text-violet-600" />
                </div>
                <h2 className="text-lg font-semibold">Hi! I&apos;m Padvik AI</h2>
                <p className="text-sm text-muted-foreground mt-1 max-w-md">
                  Ask me anything about your studies — Math, Science, Social Studies, Languages, or any subject. I can explain concepts, solve problems, and help you prepare for exams.
                </p>
                <div className="flex flex-wrap justify-center gap-2 mt-6">
                  {[
                    "Explain Pythagoras theorem with examples",
                    "What is photosynthesis? Draw a diagram",
                    "Help me solve quadratic equations",
                    "Explain the French Revolution",
                    "What are Newton's laws of motion?",
                    "Help me with English grammar — tenses",
                  ].map((q) => (
                    <button
                      key={q}
                      onClick={() => sendMessage(q)}
                      className="text-xs px-3 py-1.5 rounded-full border hover:bg-violet-50 hover:border-violet-300 dark:hover:bg-violet-950/30 transition-colors text-muted-foreground"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={cn("flex flex-col", msg.role === "user" ? "items-end" : "items-start")}>
                <div className={cn(
                  "max-w-[75%] rounded-2xl px-4 py-3",
                  msg.role === "user"
                    ? "bg-violet-600 text-white rounded-br-md"
                    : "bg-muted rounded-bl-md"
                )}>
                  {msg.role === "assistant" ? (
                    <MarkdownRenderer content={msg.content} className="[&_p]:text-sm [&_p]:my-1.5 [&_li]:text-sm" />
                  ) : (
                    <p className="text-sm leading-relaxed">{msg.content}</p>
                  )}
                </div>
                {msg.role === "assistant" && msg.provider && (
                  <span className="text-[9px] text-muted-foreground mt-0.5 px-1">
                    {msg.provider}{msg.model ? ` · ${msg.model.split("-").slice(0, 2).join("-")}` : ""}
                  </span>
                )}
              </div>
            ))}

            {sending && (
              <div className="flex justify-start">
                <div className="bg-muted rounded-2xl rounded-bl-md px-5 py-3.5">
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin text-violet-500" />
                    <span className="text-xs text-muted-foreground">Thinking...</span>
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </ScrollArea>

        {/* Suggestions */}
        {suggestions.length > 0 && (
          <div className="flex gap-2 px-4 py-2 border-t bg-muted/30 overflow-x-auto">
            {suggestions.map((s, i) => (
              <button
                key={i}
                onClick={() => sendMessage(s)}
                className="shrink-0 text-xs px-3 py-1.5 rounded-full border hover:bg-violet-50 hover:border-violet-300 transition-colors text-muted-foreground"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {/* Input */}
        <div className="border-t px-4 py-3 shrink-0">
          <form
            onSubmit={(e) => { e.preventDefault(); sendMessage(); }}
            className="flex items-end gap-2 max-w-3xl mx-auto"
          >
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              placeholder="Ask a question... (Enter to send, Shift+Enter for new line)"
              className="flex-1 resize-none text-sm bg-muted/50 rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-violet-500/20 placeholder:text-muted-foreground/60 min-h-[40px] max-h-[120px]"
              rows={1}
              disabled={sending}
            />
            <button
              type="submit"
              disabled={!input.trim() || sending}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-600 text-white disabled:opacity-40 hover:bg-violet-700 transition-colors"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
