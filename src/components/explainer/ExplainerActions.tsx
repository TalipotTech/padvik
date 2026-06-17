"use client";

import { useState } from "react";
import { Check, Sparkles, MessageCircle, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ExplainerActionKind = "got_it" | "explain_more" | "ask_question";

export function ExplainerActions({
  onGotIt,
  onExplainMore,
  onAsk,
  disabled,
  isLoading,
}: {
  onGotIt: () => void;
  onExplainMore: () => void;
  onAsk: (question: string) => void;
  disabled?: boolean;
  isLoading?: ExplainerActionKind | null;
}) {
  const [askOpen, setAskOpen] = useState(false);
  const [question, setQuestion] = useState("");

  const submitAsk = () => {
    const q = question.trim();
    if (!q) return;
    onAsk(q);
    setQuestion("");
    setAskOpen(false);
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          onClick={onGotIt}
          disabled={disabled || isLoading !== null}
          className="flex-1 bg-emerald-600 text-white hover:bg-emerald-700"
        >
          <Check size={16} />
          {isLoading === "got_it" ? "Saving..." : "Got it"}
        </Button>

        <Button
          onClick={onExplainMore}
          disabled={disabled || isLoading !== null}
          variant="outline"
          className="flex-1 border-purple-400 text-purple-700 hover:bg-purple-50 dark:border-purple-600 dark:text-purple-300 dark:hover:bg-purple-950"
        >
          <Sparkles size={16} />
          {isLoading === "explain_more" ? "Thinking..." : "Explain differently"}
        </Button>

        <Button
          onClick={() => setAskOpen((v) => !v)}
          disabled={disabled || isLoading !== null}
          variant="outline"
          className={cn(
            "flex-1",
            askOpen && "border-purple-600 bg-purple-50 dark:bg-purple-950"
          )}
        >
          <MessageCircle size={16} />
          Ask a question
        </Button>
      </div>

      {askOpen && (
        <div className="flex items-start gap-2 rounded-lg border border-purple-200 bg-purple-50/50 p-2 dark:border-purple-900 dark:bg-purple-950/30">
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="What's confusing? Type your question..."
            rows={2}
            className="flex-1 resize-none rounded-md border border-purple-200 bg-white px-3 py-2 text-sm outline-none focus:border-purple-500 dark:border-purple-800 dark:bg-slate-900"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submitAsk();
              }
            }}
          />
          <Button
            size="icon"
            onClick={submitAsk}
            disabled={!question.trim() || isLoading !== null}
            className="bg-purple-600 text-white hover:bg-purple-700"
          >
            {isLoading === "ask_question" ? (
              <Sparkles size={16} className="animate-pulse" />
            ) : (
              <Send size={16} />
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
