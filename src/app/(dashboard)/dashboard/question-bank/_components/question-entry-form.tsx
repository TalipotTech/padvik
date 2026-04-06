"use client";

import { useState } from "react";
import { Plus, Minus, Eye } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiFetch } from "@/lib/api-client";
import { CurriculumFilterBar, type CurriculumFilter } from "./curriculum-filter-bar";

interface Option {
  label: string;
  text: string;
  isCorrect: boolean;
}

export function QuestionEntryForm({ onSuccess }: { onSuccess?: () => void }) {
  const [filter, setFilter] = useState<CurriculumFilter>({ subjectId: "", chapterId: "", topicId: "" });
  const topicId = filter.topicId && filter.topicId !== "all" ? filter.topicId : "";
  const [questionType, setQuestionType] = useState("mcq");
  const [difficulty, setDifficulty] = useState("medium");
  const [questionText, setQuestionText] = useState("");
  const [options, setOptions] = useState<Option[]>([
    { label: "a", text: "", isCorrect: false },
    { label: "b", text: "", isCorrect: false },
    { label: "c", text: "", isCorrect: false },
    { label: "d", text: "", isCorrect: false },
  ]);
  const [correctAnswer, setCorrectAnswer] = useState("");
  const [solution, setSolution] = useState("");
  const [marks, setMarks] = useState("1");
  const [tags, setTags] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  // selectedSubject/chapter removed — CurriculumFilterBar handles selection

  const handleOptionChange = (index: number, field: "text" | "isCorrect", value: string | boolean) => {
    const updated = [...options];
    if (field === "text") {
      updated[index] = { ...updated[index], text: value as string };
    } else {
      // Only one correct answer for MCQ
      updated.forEach((o, i) => (o.isCorrect = i === index));
    }
    setOptions(updated);
  };

  const addOption = () => {
    const nextLabel = String.fromCharCode(97 + options.length);
    setOptions([...options, { label: nextLabel, text: "", isCorrect: false }]);
  };

  const removeOption = (index: number) => {
    if (options.length <= 2) return;
    setOptions(options.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    if (!topicId) {
      setError("Please select a topic");
      return;
    }
    if (!questionText.trim()) {
      setError("Question text is required");
      return;
    }

    setError(null);
    setSubmitting(true);

    try {
      const payload: Record<string, unknown> = {
        topicId: Number(topicId),
        questionType,
        difficulty,
        questionText: questionText.trim(),
        marks: parseFloat(marks) || 1,
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      };

      if (questionType === "mcq") {
        payload.options = options.filter((o) => o.text.trim());
        const correct = options.find((o) => o.isCorrect);
        if (correct) payload.correctAnswer = `${correct.label}) ${correct.text}`;
      } else {
        if (correctAnswer.trim()) payload.correctAnswer = correctAnswer.trim();
      }

      if (solution.trim()) payload.solution = solution.trim();

      await apiFetch("/api/questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      // Reset form
      setQuestionText("");
      setCorrectAnswer("");
      setSolution("");
      setOptions([
        { label: "a", text: "", isCorrect: false },
        { label: "b", text: "", isCorrect: false },
        { label: "c", text: "", isCorrect: false },
        { label: "d", text: "", isCorrect: false },
      ]);
      setTags("");
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create question");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Form */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Add Question</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Curriculum filter */}
          <div className="space-y-1.5">
            <Label className="text-xs">Select Topic</Label>
            <CurriculumFilterBar onFilterChange={setFilter} value={filter} />
          </div>

          {/* Type + Difficulty + Marks */}
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Type</Label>
              <Select value={questionType} onValueChange={setQuestionType}>
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
              <Label className="text-xs">Marks</Label>
              <Input type="number" value={marks} onChange={(e) => setMarks(e.target.value)} min="0" step="0.5" />
            </div>
          </div>

          {/* Question text */}
          <div className="space-y-1.5">
            <Label className="text-xs">Question Text</Label>
            <textarea
              className="flex min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="Enter your question here... (supports KaTeX math: $x^2$)"
              value={questionText}
              onChange={(e) => setQuestionText(e.target.value)}
            />
          </div>

          {/* MCQ options */}
          {questionType === "mcq" && (
            <div className="space-y-2">
              <Label className="text-xs">Options</Label>
              {options.map((opt, i) => (
                <div key={opt.label} className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant={opt.isCorrect ? "default" : "outline"}
                    size="sm"
                    className="w-8 h-8 p-0 shrink-0"
                    onClick={() => handleOptionChange(i, "isCorrect", true)}
                    title="Mark as correct"
                  >
                    {opt.label}
                  </Button>
                  <Input
                    placeholder={`Option ${opt.label}`}
                    value={opt.text}
                    onChange={(e) => handleOptionChange(i, "text", e.target.value)}
                  />
                  {options.length > 2 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 shrink-0"
                      onClick={() => removeOption(i)}
                    >
                      <Minus className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              ))}
              {options.length < 6 && (
                <Button type="button" variant="outline" size="sm" onClick={addOption}>
                  <Plus className="h-3 w-3 mr-1" /> Add Option
                </Button>
              )}
            </div>
          )}

          {/* Answer (for non-MCQ) */}
          {questionType !== "mcq" && (
            <div className="space-y-1.5">
              <Label className="text-xs">Answer</Label>
              <textarea
                className="flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                placeholder="Enter the correct answer..."
                value={correctAnswer}
                onChange={(e) => setCorrectAnswer(e.target.value)}
              />
            </div>
          )}

          {/* Solution */}
          <div className="space-y-1.5">
            <Label className="text-xs">Solution / Explanation (optional)</Label>
            <textarea
              className="flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              placeholder="Explain the answer..."
              value={solution}
              onChange={(e) => setSolution(e.target.value)}
            />
          </div>

          {/* Tags */}
          <div className="space-y-1.5">
            <Label className="text-xs">Tags (comma-separated, optional)</Label>
            <Input
              placeholder="e.g., algebra, quadratic, important"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
            />
          </div>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          <div className="flex gap-3">
            <Button onClick={handleSubmit} disabled={submitting} className="flex-1">
              {submitting ? "Saving..." : "Save Question"}
            </Button>
            <Button
              variant="outline"
              onClick={() => setShowPreview(!showPreview)}
            >
              <Eye className="h-4 w-4 mr-1" /> Preview
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Preview */}
      {showPreview && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Preview</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2 mb-3 flex-wrap">
              <Badge variant="outline">
                {questionType === "mcq" ? "MCQ" : questionType.replace("_", " ")}
              </Badge>
              <Badge variant="secondary">{difficulty}</Badge>
              <Badge variant="outline">{marks} marks</Badge>
            </div>
            <p className="text-sm whitespace-pre-wrap mb-3">
              {questionText || "(No question text)"}
            </p>
            {questionType === "mcq" && options.some((o) => o.text) && (
              <div className="space-y-1.5">
                {options
                  .filter((o) => o.text)
                  .map((opt) => (
                    <div
                      key={opt.label}
                      className={`text-sm px-2 py-1 rounded ${
                        opt.isCorrect ? "bg-green-50 text-green-800 font-medium" : ""
                      }`}
                    >
                      {opt.label}) {opt.text}
                    </div>
                  ))}
              </div>
            )}
            {(correctAnswer || solution) && (
              <div className="mt-3 pt-3 border-t space-y-2">
                {correctAnswer && (
                  <div>
                    <p className="text-xs text-muted-foreground font-medium">Answer</p>
                    <p className="text-sm">{correctAnswer}</p>
                  </div>
                )}
                {solution && (
                  <div>
                    <p className="text-xs text-muted-foreground font-medium">Solution</p>
                    <p className="text-sm">{solution}</p>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
