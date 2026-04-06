"use client";

import { useState } from "react";
import {
  Sparkles,
  Loader2,
  CheckCircle,
  Coins,
  Clock,
  FileText,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiFetch } from "@/lib/api-client";
import { MarkdownRenderer } from "@/components/content/markdown-renderer";
import { CurriculumFilterBar, type CurriculumFilter } from "./curriculum-filter-bar";

interface GeneratedQuestion {
  id: number | null;
  questionText: string;
  questionType: string;
  difficulty: string;
  marks: number;
  bloomLevel?: string;
  options?: { label: string; text: string; isCorrect: boolean }[];
  correctAnswer: string;
  solution: string;
  tags?: string[];
  saved: boolean;
}

interface GenerateResult {
  questions: GeneratedQuestion[];
  stats: {
    generated: number;
    saved: number;
    model: string;
    costUsd: number;
    durationMs: number;
    inputTokens: number;
    outputTokens: number;
  };
  context: {
    board: string;
    grade: number;
    subject: string;
    chapter: string;
    topic: string;
  };
}

const DIFFICULTY_COLORS: Record<string, string> = {
  easy: "bg-green-100 text-green-800",
  medium: "bg-yellow-100 text-yellow-800",
  hard: "bg-red-100 text-red-800",
};

export function AIGeneratePanel() {
  const [filter, setFilter] = useState<CurriculumFilter>({ subjectId: "", chapterId: "", topicId: "" });
  const [questionType, setQuestionType] = useState("mcq");
  const [difficulty, setDifficulty] = useState("medium");
  const [count, setCount] = useState("5");
  const [marks, setMarks] = useState("1");
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generatingPaper, setGeneratingPaper] = useState(false);

  const topicId = filter.topicId && filter.topicId !== "all" ? filter.topicId : "";
  const subjectId = filter.subjectId && filter.subjectId !== "all" ? filter.subjectId : "";

  const handleGenerate = async () => {
    if (!topicId) { setError("Select a topic"); return; }
    setError(null);
    setGenerating(true);
    setResult(null);

    try {
      const data = await apiFetch<GenerateResult>("/api/questions/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topicId: Number(topicId),
          questionType,
          difficulty,
          count: parseInt(count),
          marks: parseFloat(marks),
          autoSave: true,
        }),
      });
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  };

  const handleGeneratePaper = async () => {
    if (!subjectId) { setError("Select a subject"); return; }
    setError(null);
    setGeneratingPaper(true);

    try {
      const data = await apiFetch<{
        paperId: number;
        paperTitle: string;
        questionsGenerated: number;
        stats: { totalCostUsd: number };
      }>("/api/questions/generate-paper", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subjectId: Number(subjectId) }),
      });
      setError(`Paper generated: "${data.paperTitle}" — ${data.questionsGenerated} questions ($${data.stats.totalCostUsd.toFixed(3)}). View in Question Viewer or Paper Verifier.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Paper generation failed");
    } finally {
      setGeneratingPaper(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Generation Form */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-violet-600" />
              Generate Questions
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Curriculum filter */}
            <div className="space-y-2">
              <Label className="text-xs">Select Topic</Label>
              <CurriculumFilterBar
                onFilterChange={setFilter}
                value={filter}
              />
            </div>

            {/* Generation options */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Type</Label>
                <Select value={questionType} onValueChange={(v) => { setQuestionType(v); setMarks(v === "mcq" ? "1" : v === "short_answer" ? "2" : "5"); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="mcq">MCQ</SelectItem>
                    <SelectItem value="short_answer">Short Answer</SelectItem>
                    <SelectItem value="long_answer">Long Answer</SelectItem>
                    <SelectItem value="fill_blank">Fill in Blank</SelectItem>
                    <SelectItem value="true_false">True/False</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Difficulty</Label>
                <Select value={difficulty} onValueChange={setDifficulty}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="easy">Easy</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="hard">Hard</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Count</Label>
                <Select value={count} onValueChange={setCount}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 5, 10, 15, 20].map((n) => (
                      <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Marks each</Label>
                <Select value={marks} onValueChange={setMarks}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[0.5, 1, 2, 3, 4, 5].map((n) => (
                      <SelectItem key={n} value={String(n)}>{n}m</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {error && (
              <p className={`text-xs ${error.startsWith("Paper generated") ? "text-green-700" : "text-destructive"}`}>
                {error}
              </p>
            )}

            <Button className="w-full" onClick={handleGenerate} disabled={generating || !topicId}>
              {generating ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Generating...</>
              ) : (
                <><Sparkles className="h-4 w-4 mr-2" /> Generate {count} Questions</>
              )}
            </Button>

            {/* Generate Full Paper */}
            {subjectId && (
              <>
                <div className="relative">
                  <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
                  <div className="relative flex justify-center text-xs uppercase"><span className="bg-card px-2 text-muted-foreground">or</span></div>
                </div>

                <Button
                  variant="outline"
                  className="w-full text-xs"
                  onClick={handleGeneratePaper}
                  disabled={generatingPaper}
                >
                  {generatingPaper ? (
                    <><Loader2 className="h-3 w-3 mr-2 animate-spin" /> Generating Paper...</>
                  ) : (
                    <><FileText className="h-3 w-3 mr-2" /> Generate Full Mock Paper</>
                  )}
                </Button>
                <p className="text-[10px] text-muted-foreground text-center">
                  Creates a complete CBSE-pattern paper (80 marks, 38 questions, 5 sections)
                </p>
              </>
            )}
          </CardContent>
        </Card>

        {/* Generated Results */}
        <div className="lg:col-span-2 space-y-3">
          {/* Stats */}
          {result && (
            <Card className="border-violet-200 bg-violet-50/30">
              <CardContent className="pt-3 pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-violet-800">
                      Generated {result.stats.generated} questions for{" "}
                      <strong>{result.context.topic}</strong>
                    </p>
                    <p className="text-xs text-violet-600 mt-0.5">
                      {result.context.subject} → {result.context.chapter}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-violet-600">
                    <span className="flex items-center gap-1">
                      <Coins className="h-3 w-3" /> ${result.stats.costUsd.toFixed(4)}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" /> {(result.stats.durationMs / 1000).toFixed(1)}s
                    </span>
                    <Badge variant="outline" className="text-[10px]">{result.stats.model}</Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Question cards */}
          {generating && (
            <Card>
              <CardContent className="py-12 text-center">
                <Loader2 className="h-8 w-8 animate-spin mx-auto text-violet-600 mb-3" />
                <p className="text-sm font-medium">Generating questions with AI...</p>
                <p className="text-xs text-muted-foreground mt-1">This may take 10-30 seconds</p>
              </CardContent>
            </Card>
          )}

          {result?.questions.map((q, i) => (
            <Card key={q.id ?? i} className="overflow-hidden">
              <CardContent className="pt-4 pb-3">
                {/* Header */}
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-sm font-bold text-violet-700">Q{i + 1}</span>
                  <Badge variant="outline" className="text-[10px]">
                    {q.questionType === "mcq" ? "MCQ" : q.questionType.replace("_", " ")}
                  </Badge>
                  <Badge className={`text-[10px] ${DIFFICULTY_COLORS[q.difficulty] ?? ""}`}>
                    {q.difficulty}
                  </Badge>
                  <Badge variant="outline" className="text-[10px]">
                    {q.marks} mark{q.marks !== 1 ? "s" : ""}
                  </Badge>
                  {q.bloomLevel && (
                    <Badge variant="secondary" className="text-[10px]">{q.bloomLevel}</Badge>
                  )}
                  {q.saved && (
                    <CheckCircle className="h-3.5 w-3.5 text-green-500 ml-auto" />
                  )}
                </div>

                {/* Question text */}
                <MarkdownRenderer content={q.questionText} className="text-sm mb-3" />

                {/* MCQ Options */}
                {q.options && q.options.length > 0 && (
                  <div className="rounded-lg border overflow-hidden mb-3">
                    {q.options.map((opt, j) => (
                      <div
                        key={opt.label}
                        className={`flex items-center gap-3 px-3 py-2 text-sm ${
                          j > 0 ? "border-t" : ""
                        } ${opt.isCorrect ? "bg-green-50" : ""}`}
                      >
                        <span
                          className={`flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold shrink-0 ${
                            opt.isCorrect
                              ? "bg-green-600 text-white"
                              : "bg-gray-100 text-gray-600"
                          }`}
                        >
                          {opt.label.toUpperCase()}
                        </span>
                        <span className={opt.isCorrect ? "font-medium text-green-900" : ""}>
                          {opt.text}
                        </span>
                        {opt.isCorrect && <CheckCircle className="h-4 w-4 text-green-600 ml-auto" />}
                      </div>
                    ))}
                  </div>
                )}

                {/* Answer */}
                <div className="rounded-lg border-2 border-green-300 bg-green-50 p-3 mb-2">
                  <p className="text-xs font-bold text-green-800 uppercase tracking-wide mb-1">Answer</p>
                  <MarkdownRenderer content={q.correctAnswer} className="text-sm text-green-900 [&_p]:m-0" />
                </div>

                {/* Solution */}
                {q.solution && (
                  <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
                    <p className="text-xs font-bold text-blue-800 uppercase tracking-wide mb-1">Solution</p>
                    <MarkdownRenderer content={q.solution} className="text-sm text-blue-900 [&_p]:m-0" />
                  </div>
                )}
              </CardContent>
            </Card>
          ))}

          {!generating && !result && (
            <Card>
              <CardContent className="py-16 text-center text-muted-foreground">
                <Sparkles className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p className="font-medium">AI Question Generator</p>
                <p className="text-xs mt-1 max-w-sm mx-auto">
                  Select a topic and click Generate. The AI creates original, board-pattern-compliant questions with answers and step-by-step solutions.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
