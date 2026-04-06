"use client";

import { useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Share2,
  Trash2,
  CheckCircle,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ShareDialog } from "./share-dialog";
import { apiFetch } from "@/lib/api-client";
import { MarkdownRenderer } from "@/components/content/markdown-renderer";

interface Question {
  id: number;
  questionType: string;
  difficulty: string;
  questionText: string;
  options: { label: string; text: string; isCorrect?: boolean }[] | null;
  correctAnswer: string | null;
  solution: string | null;
  marks: string;
  sectionLabel: string | null;
  sourceType: string;
  tags: string[];
  createdAt: string;
  createdBy: number | null;
}

const DIFFICULTY_COLORS: Record<string, string> = {
  easy: "bg-green-100 text-green-800",
  medium: "bg-yellow-100 text-yellow-800",
  hard: "bg-red-100 text-red-800",
};

const TYPE_LABELS: Record<string, string> = {
  mcq: "MCQ",
  short_answer: "Short Answer",
  long_answer: "Long Answer",
  fill_blank: "Fill in Blank",
  true_false: "True/False",
};

const SOURCE_LABELS: Record<string, string> = {
  scraped: "Official",
  user_uploaded: "User",
  ai_generated: "AI",
  official: "Official",
};

export function QuestionCard({
  question,
  onUpdate,
}: {
  question: Question;
  onUpdate?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!confirm("Are you sure you want to delete this question?")) return;
    setDeleting(true);
    try {
      await apiFetch(`/api/questions/${question.id}`, { method: "DELETE" });
      onUpdate?.();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <Card className="overflow-hidden">
        <CardContent className="pt-4 pb-3">
          {/* Header badges */}
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <Badge variant="outline" className="text-xs">
              {TYPE_LABELS[question.questionType] ?? question.questionType}
            </Badge>
            <Badge
              variant="secondary"
              className={`text-xs ${DIFFICULTY_COLORS[question.difficulty] ?? ""}`}
            >
              {question.difficulty}
            </Badge>
            <Badge variant="outline" className="text-xs">
              {parseFloat(question.marks)} marks
            </Badge>
            {question.sectionLabel && (
              <Badge variant="outline" className="text-xs">
                Section {question.sectionLabel}
              </Badge>
            )}
            <Badge variant="secondary" className="text-xs ml-auto">
              {SOURCE_LABELS[question.sourceType] ?? question.sourceType}
            </Badge>
          </div>

          {/* Question text */}
          <MarkdownRenderer
            content={
              question.questionText.length > 300 && !expanded
                ? question.questionText.slice(0, 300) + "..."
                : question.questionText
            }
            className="text-sm"
          />

          {/* MCQ options */}
          {question.options && question.options.length > 0 && (
            <div className="mt-3 space-y-1.5">
              {question.options.map((opt, i) => (
                <div
                  key={opt.label ?? i}
                  className={`flex items-start gap-2 text-sm px-2 py-1 rounded ${
                    expanded && opt.isCorrect
                      ? "bg-green-50 text-green-800"
                      : ""
                  }`}
                >
                  <span className="font-medium text-muted-foreground min-w-[1.5rem]">
                    {opt.label ?? String.fromCharCode(97 + i)})
                  </span>
                  <span>{opt.text}</span>
                  {expanded && opt.isCorrect && (
                    <CheckCircle className="h-4 w-4 text-green-600 ml-auto shrink-0" />
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Expanded: answer + solution */}
          {expanded && (
            <div className="mt-4 space-y-3 border-t pt-3">
              {question.correctAnswer && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                  <p className="text-xs font-bold text-green-800 uppercase tracking-wide mb-1">
                    Answer
                  </p>
                  <MarkdownRenderer content={question.correctAnswer} className="text-sm text-green-900 [&_p]:m-0" />
                </div>
              )}
              {question.solution && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                  <p className="text-xs font-bold text-blue-800 uppercase tracking-wide mb-1">
                    Solution
                  </p>
                  <MarkdownRenderer content={question.solution} className="text-sm text-blue-900 [&_p]:m-0" />
                </div>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 mt-3 pt-2 border-t">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setExpanded(!expanded)}
              className="text-xs"
            >
              {expanded ? (
                <>
                  <ChevronUp className="h-3 w-3 mr-1" /> Less
                </>
              ) : (
                <>
                  <ChevronDown className="h-3 w-3 mr-1" /> More
                </>
              )}
            </Button>

            {question.createdBy && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs ml-auto"
                  onClick={() => setShowShareDialog(true)}
                >
                  <Share2 className="h-3 w-3 mr-1" /> Share
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs text-destructive"
                  onClick={handleDelete}
                  disabled={deleting}
                >
                  <Trash2 className="h-3 w-3 mr-1" /> Delete
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {showShareDialog && (
        <ShareDialog
          questionIds={[question.id]}
          open={showShareDialog}
          onClose={() => setShowShareDialog(false)}
        />
      )}
    </>
  );
}
