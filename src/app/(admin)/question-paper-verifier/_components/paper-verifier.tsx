"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Search,
  FileText,
  ExternalLink,
  Download,
  ChevronDown,
  ChevronUp,
  CheckCircle,
  BookOpen,
  Loader2,
  Hash,
  Clock,
  Award,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { MarkdownRenderer } from "@/components/content/markdown-renderer";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface PaperSummary {
  id: number;
  title: string;
  year: number;
  type: string;
  sourceUrl: string | null;
  questionCount: number;
  status: string;
  totalMarks: number | null;
}

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
  questionNumber: string | null;
  sourceType: string;
  language: string;
  bloomLevel: string | null;
}

interface Section {
  label: string;
  title: string;
  questions: Question[];
}

interface PaperDetail {
  id: number;
  paperTitle: string;
  paperYear: number;
  paperType: string;
  sourceUrl: string | null;
  totalMarks: number | null;
  durationMinutes: number | null;
  parsingStatus: string;
  parsedBy: string | null;
  questionCount: number;
  aiModel?: string;
}

interface VerifierData {
  board: { id: number; code: string; name: string } | null;
  papers: PaperSummary[];
  paper: PaperDetail | null;
  sections: Section[];
  totalQuestions: number;
}

const BOARDS = ["CBSE", "ICSE", "KL_SCERT"];

const STATUS_COLORS: Record<string, string> = {
  completed: "bg-green-100 text-green-800",
  processing: "bg-yellow-100 text-yellow-800",
  failed: "bg-red-100 text-red-800",
  pending: "bg-gray-100 text-gray-800",
};

const DIFFICULTY_COLORS: Record<string, string> = {
  easy: "bg-green-100 text-green-800",
  medium: "bg-yellow-100 text-yellow-800",
  hard: "bg-red-100 text-red-800",
};

const TYPE_LABELS: Record<string, string> = {
  mcq: "MCQ",
  short_answer: "Short",
  long_answer: "Long",
  fill_blank: "Fill",
  true_false: "T/F",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function PaperVerifier() {
  const [boardCode, setBoardCode] = useState("CBSE");
  const [grade, setGrade] = useState("10");
  const [selectedPaperId, setSelectedPaperId] = useState<number | null>(null);
  const [data, setData] = useState<VerifierData | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [paperSearch, setPaperSearch] = useState("");
  const [showPdf, setShowPdf] = useState(false);
  const [expandedQuestions, setExpandedQuestions] = useState<Set<number>>(new Set());
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

  // Fetch papers list
  const fetchPapers = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ boardCode });
    if (grade !== "all") params.set("grade", grade);
    if (selectedPaperId) params.set("paperId", String(selectedPaperId));

    try {
      const res = await fetch(`/api/admin/question-paper-verifier?${params}`);
      const body = await res.json();
      if (body.success) {
        setData(body.data);
        // Auto-expand all sections when paper loads
        if (body.data.sections?.length) {
          setExpandedSections(new Set(body.data.sections.map((s: Section) => s.label)));
        }
      }
    } catch {
      // Handle silently
    } finally {
      setLoading(false);
    }
  }, [boardCode, grade, selectedPaperId]);

  useEffect(() => {
    fetchPapers();
  }, [fetchPapers]);

  // Auto-select first paper
  useEffect(() => {
    if (data?.papers.length && !selectedPaperId) {
      setSelectedPaperId(data.papers[0].id);
    }
  }, [data?.papers, selectedPaperId]);

  const toggleQuestion = (id: number) => {
    setExpandedQuestions((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSection = (label: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      next.has(label) ? next.delete(label) : next.add(label);
      return next;
    });
  };

  const expandAll = () => {
    if (data?.sections) {
      setExpandedSections(new Set(data.sections.map((s) => s.label)));
      const allIds = data.sections.flatMap((s) => s.questions.map((q) => q.id));
      setExpandedQuestions(new Set(allIds));
    }
  };

  const collapseAll = () => {
    setExpandedSections(new Set());
    setExpandedQuestions(new Set());
  };

  // Filter questions by search
  const filteredSections = useMemo(() => {
    if (!search || !data?.sections) return data?.sections ?? [];
    const q = search.toLowerCase();
    return data.sections
      .map((s) => ({
        ...s,
        questions: s.questions.filter((qu) =>
          qu.questionText.toLowerCase().includes(q)
        ),
      }))
      .filter((s) => s.questions.length > 0);
  }, [data?.sections, search]);

  const matchCount = search
    ? filteredSections.reduce((s, sec) => s + sec.questions.length, 0)
    : 0;

  const paper = data?.paper;

  // Download questions as text
  const downloadQuestions = () => {
    if (!data?.sections || !paper) return;
    let text = `${paper.paperTitle}\n${"=".repeat(60)}\n\n`;
    for (const sec of data.sections) {
      text += `${sec.title}\n${"-".repeat(40)}\n\n`;
      for (const q of sec.questions) {
        text += `Q${q.questionNumber ?? ""}. [${q.marks}m] ${q.questionText}\n`;
        if (q.options) {
          for (const o of q.options) {
            text += `  ${o.label}) ${o.text}${o.isCorrect ? " ✓" : ""}\n`;
          }
        }
        if (q.correctAnswer) text += `  Answer: ${q.correctAnswer}\n`;
        if (q.solution) text += `  Solution: ${q.solution}\n`;
        text += "\n";
      }
    }
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${paper.paperTitle.replace(/[^a-zA-Z0-9]/g, "_")}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex gap-3 items-end">
        <div className="space-y-1">
          <span className="text-xs text-muted-foreground">Board</span>
          <Select value={boardCode} onValueChange={(v) => { setBoardCode(v); setSelectedPaperId(null); }}>
            <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {BOARDS.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <span className="text-xs text-muted-foreground">Grade</span>
          <Select value={grade} onValueChange={(v) => { setGrade(v); setSelectedPaperId(null); }}>
            <SelectTrigger className="w-[110px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {Array.from({ length: 12 }, (_, i) => (
                <SelectItem key={i + 1} value={String(i + 1)}>Class {i + 1}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <span className="text-xs text-muted-foreground ml-auto self-end">
          {data?.papers.length ?? 0} papers found
        </span>
      </div>

      {/* Two-column layout — right panel scrolls with page, left sidebar is sticky */}
      <div className="flex gap-4 items-start">
        {/* Left sidebar — Paper list (sticky) */}
        <div className="w-[280px] shrink-0 hidden lg:block">
          <Card className="sticky top-20 overflow-hidden" style={{ maxHeight: "calc(100vh - 100px)" }}>
            <div className="flex flex-col h-full">
              <div className="px-3 py-2 border-b space-y-2 shrink-0">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Question Papers ({data?.papers.length ?? 0})
                </p>
                <Input
                  placeholder="Filter papers..."
                  className="h-7 text-xs"
                  value={paperSearch}
                  onChange={(e) => setPaperSearch(e.target.value)}
                />
              </div>
              <ScrollArea className="flex-1">
                {loading && !data ? (
                  <div className="p-3 space-y-2">
                    {[1, 2, 3].map((i) => <Skeleton key={i} className="h-14 w-full" />)}
                  </div>
                ) : (data?.papers ?? []).length === 0 ? (
                  <div className="p-4 text-center text-xs text-muted-foreground">
                    No papers found for this board/grade
                  </div>
                ) : (
                  <div className="py-1">
                    {data?.papers
                      .filter((p) => !paperSearch || p.title.toLowerCase().includes(paperSearch.toLowerCase()))
                      .map((p) => {
                        const isActive = p.id === selectedPaperId;
                        return (
                          <button
                            key={p.id}
                            className={`w-full text-left px-3 py-2.5 transition-colors border-l-2 ${
                              isActive
                                ? "bg-violet-50 border-violet-600"
                                : "border-transparent hover:bg-muted/50"
                            }`}
                            onClick={() => setSelectedPaperId(p.id)}
                          >
                            <div className="flex items-start gap-2">
                              <FileText className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${isActive ? "text-violet-600" : "text-muted-foreground"}`} />
                              <div className="min-w-0 flex-1">
                                <p className={`text-xs font-medium leading-tight ${isActive ? "text-violet-700" : ""}`}>
                                  {p.title}
                                </p>
                                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                                  <Badge variant="outline" className="text-[9px] px-1 py-0">{p.year}</Badge>
                                  <Badge variant="outline" className="text-[9px] px-1 py-0">{p.type}</Badge>
                                  <Badge
                                    variant="secondary"
                                    className={`text-[9px] px-1 py-0 ${STATUS_COLORS[p.status] ?? ""}`}
                                  >
                                    {p.questionCount} Q
                                  </Badge>
                                </div>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                  </div>
                )}
              </ScrollArea>
            </div>
          </Card>
        </div>

        {/* Mobile paper selector */}
        <div className="lg:hidden w-full mb-2">
          <Select
            value={selectedPaperId ? String(selectedPaperId) : ""}
            onValueChange={(v) => setSelectedPaperId(parseInt(v))}
          >
            <SelectTrigger><SelectValue placeholder="Select paper" /></SelectTrigger>
            <SelectContent>
              {data?.papers.map((p) => (
                <SelectItem key={p.id} value={String(p.id)}>
                  {p.title} ({p.questionCount} Q)
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Right panel */}
        <div className="flex-1 min-w-0 space-y-3">
          {!selectedPaperId ? (
            <Card>
              <CardContent className="py-16 text-center text-muted-foreground">
                <FileText className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p className="font-medium">Select a question paper</p>
                <p className="text-xs mt-1">Choose a paper from the left to view its parsed questions</p>
              </CardContent>
            </Card>
          ) : loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full" />)}
            </div>
          ) : paper ? (
            <>
              {/* Paper info bar */}
              <Card>
                <CardContent className="pt-3 pb-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <BookOpen className="h-4 w-4 text-violet-600 shrink-0" />
                        <h2 className="text-sm font-semibold truncate">{paper.paperTitle}</h2>
                      </div>
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        <Badge variant="outline" className="text-xs">{paper.paperYear}</Badge>
                        <Badge variant="outline" className="text-xs">{paper.paperType}</Badge>
                        <Badge className={`text-xs ${STATUS_COLORS[paper.parsingStatus] ?? ""}`}>
                          {paper.parsingStatus}
                        </Badge>
                        {paper.aiModel && (
                          <span className="text-[10px] text-muted-foreground">
                            Parsed by: {String(paper.aiModel)}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Hash className="h-3 w-3" /> {data?.totalQuestions ?? 0} questions
                        </span>
                        {paper.totalMarks && (
                          <span className="flex items-center gap-1">
                            <Award className="h-3 w-3" /> {paper.totalMarks} marks
                          </span>
                        )}
                        {paper.durationMinutes && (
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" /> {paper.durationMinutes} min
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Action buttons */}
                    <div className="flex items-center gap-2 shrink-0">
                      {/* Search */}
                      <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                        <Input
                          placeholder="Find in questions..."
                          className="h-8 pl-8 w-[180px] text-xs"
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                        />
                        {search && matchCount > 0 && (
                          <Badge variant="secondary" className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px]">
                            {matchCount}
                          </Badge>
                        )}
                      </div>

                      {/* Toggle PDF side-by-side */}
                      {paper.sourceUrl && (
                        <Button
                          variant={showPdf ? "default" : "outline"}
                          size="sm"
                          className="text-xs gap-1"
                          onClick={() => setShowPdf(!showPdf)}
                        >
                          <ExternalLink className="h-3 w-3" /> {showPdf ? "Hide PDF" : "Show PDF"}
                        </Button>
                      )}

                      {/* Open PDF in new tab */}
                      {paper.sourceUrl && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-xs gap-1"
                          onClick={() => window.open(paper.sourceUrl!, "_blank")}
                        >
                          <ExternalLink className="h-3 w-3" />
                        </Button>
                      )}

                      {/* Download */}
                      <Button variant="outline" size="sm" className="text-xs gap-1" onClick={downloadQuestions}>
                        <Download className="h-3 w-3" /> Download
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Split view: PDF (left) + Questions (right) */}
              <div className={`flex gap-3 ${showPdf ? "" : ""}`}>
                {/* PDF viewer panel */}
                {showPdf && paper.sourceUrl && (
                  <div className="w-1/2 shrink-0 sticky top-20" style={{ height: "calc(100vh - 180px)" }}>
                    <Card className="h-full overflow-hidden">
                      <div className="flex items-center justify-between px-3 py-1.5 border-b bg-muted/30">
                        <span className="text-xs font-medium text-muted-foreground">Original PDF</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-[10px] h-6"
                          onClick={() => window.open(paper.sourceUrl!, "_blank")}
                        >
                          Open in new tab <ExternalLink className="h-3 w-3 ml-1" />
                        </Button>
                      </div>
                      <iframe
                        src={`/api/admin/pdf-proxy?url=${encodeURIComponent(paper.sourceUrl)}`}
                        className="w-full border-0"
                        style={{ height: "calc(100% - 36px)" }}
                        title="Original PDF"
                      />
                    </Card>
                  </div>
                )}

                {/* Questions panel */}
                <div className={`${showPdf ? "w-1/2" : "w-full"} space-y-2`}>
                  {/* Controls */}
                  <div className="flex items-center gap-2 text-xs">
                    <Button variant="ghost" size="sm" className="text-xs" onClick={expandAll}>
                      Expand All
                    </Button>
                    <Button variant="ghost" size="sm" className="text-xs" onClick={collapseAll}>
                      Collapse All
                    </Button>
                    {search && (
                      <span className="text-muted-foreground ml-2">
                        {matchCount} match{matchCount !== 1 ? "es" : ""} found
                      </span>
                    )}
                    <span className="ml-auto text-muted-foreground">
                      {filteredSections.reduce((s, sec) => s + sec.questions.length, 0)} questions in{" "}
                      {filteredSections.length} sections
                    </span>
                  </div>

                  {/* Sections → Questions */}
                  {filteredSections.length === 0 ? (
                    <Card>
                      <CardContent className="py-8 text-center text-muted-foreground text-sm">
                        {search ? "No questions match your search" : "No questions found for this paper"}
                      </CardContent>
                    </Card>
                  ) : (
                    <div className="space-y-2">
                      {filteredSections.map((section) => {
                        const isExpanded = expandedSections.has(section.label);
                        return (
                          <Card key={section.label}>
                            {/* Section header */}
                            <div
                              className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors"
                              onClick={() => toggleSection(section.label)}
                            >
                              {isExpanded ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronUp className="h-4 w-4 shrink-0 rotate-90" />}
                              <span className="text-sm font-medium flex-1">{section.title}</span>
                              <Badge variant="secondary" className="text-xs">
                                {section.questions.length} Q
                              </Badge>
                            </div>

                            {/* Questions */}
                            {isExpanded && (
                              <div className="border-t divide-y">
                                {section.questions.map((q) => (
                                  <QuestionRow
                                    key={q.id}
                                    question={q}
                                    expanded={expandedQuestions.has(q.id)}
                                    onToggle={() => toggleQuestion(q.id)}
                                    searchHighlight={search}
                                  />
                                ))}
                              </div>
                            )}
                          </Card>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Question Row — exam-paper style with clear visual hierarchy
// ---------------------------------------------------------------------------
function QuestionRow({
  question: q,
  expanded,
  onToggle,
  searchHighlight,
}: {
  question: Question;
  expanded: boolean;
  onToggle: () => void;
  searchHighlight: string;
}) {
  const hasOptions = q.options && q.options.length > 0;
  const hasAnswer = q.correctAnswer || (hasOptions && q.options!.some((o) => o.isCorrect));

  return (
    <div
      className={`px-5 py-3 cursor-pointer transition-colors ${
        expanded ? "bg-violet-50/30" : "hover:bg-muted/20"
      }`}
      onClick={onToggle}
    >
      {/* Question header line */}
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-sm font-bold text-violet-700 min-w-[2rem]">
          Q{q.questionNumber ?? "?"}
        </span>
        <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-medium">
          {TYPE_LABELS[q.questionType] ?? q.questionType}
        </Badge>
        <Badge className={`text-[10px] px-1.5 py-0 ${DIFFICULTY_COLORS[q.difficulty] ?? "bg-gray-100"}`}>
          {q.difficulty}
        </Badge>
        <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-semibold">
          {parseFloat(q.marks)} mark{parseFloat(q.marks) !== 1 ? "s" : ""}
        </Badge>
        {q.language !== "en" && (
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 uppercase">{q.language}</Badge>
        )}
        {hasAnswer && (
          <CheckCircle className="h-3.5 w-3.5 text-green-500 ml-auto" />
        )}
        {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </div>

      {/* Question text */}
      <div className="pl-[2rem]">
        <p className="text-sm leading-relaxed text-foreground whitespace-pre-wrap">
          <HighlightText
            text={!expanded && q.questionText.length > 250 ? q.questionText.slice(0, 250) + "..." : q.questionText}
            highlight={searchHighlight}
          />
        </p>

        {/* Figure description callout */}
        {expanded && q.questionText.includes("[Figure:") && (
          <div className="mt-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-md text-xs text-amber-800">
            <span className="font-medium">This question references a figure/diagram.</span> Use &ldquo;Show PDF&rdquo; to view the original image.
          </div>
        )}

        {expanded && (
          <div className="mt-3 space-y-3" onClick={(e) => e.stopPropagation()}>
            {/* MCQ Options */}
            {hasOptions && (
              <div className="rounded-lg border overflow-hidden">
                {q.options!.map((opt, i) => (
                  <div
                    key={opt.label ?? i}
                    className={`flex items-center gap-3 px-3 py-2 text-sm ${
                      i > 0 ? "border-t" : ""
                    } ${
                      opt.isCorrect
                        ? "bg-green-50 border-green-200"
                        : "bg-white"
                    }`}
                  >
                    <span
                      className={`flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold shrink-0 ${
                        opt.isCorrect
                          ? "bg-green-600 text-white"
                          : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {(opt.label ?? String.fromCharCode(65 + i)).toUpperCase()}
                    </span>
                    <span className={opt.isCorrect ? "font-medium text-green-900" : "text-foreground"}>
                      {opt.text ?? ""}
                    </span>
                    {opt.isCorrect && (
                      <CheckCircle className="h-4 w-4 text-green-600 ml-auto shrink-0" />
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Answer */}
            {q.correctAnswer && (
              <div className="rounded-lg border-2 border-green-300 bg-green-50 p-3">
                <div className="flex items-center gap-2 mb-1">
                  <CheckCircle className="h-4 w-4 text-green-600" />
                  <span className="text-xs font-bold text-green-800 uppercase tracking-wide">Answer</span>
                </div>
                <MarkdownRenderer content={q.correctAnswer} className="text-sm text-green-900 [&_p]:m-0" />
              </div>
            )}

            {/* Solution */}
            {q.solution && (
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
                <div className="flex items-center gap-2 mb-1">
                  <BookOpen className="h-4 w-4 text-blue-600" />
                  <span className="text-xs font-bold text-blue-800 uppercase tracking-wide">Solution</span>
                </div>
                <MarkdownRenderer content={q.solution} className="text-sm text-blue-900 [&_p]:m-0" />
              </div>
            )}

            {/* Metadata */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-muted-foreground pt-1 border-t">
              {q.bloomLevel && (
                <span>Bloom: <strong>{q.bloomLevel}</strong></span>
              )}
              <span>Type: {q.questionType}</span>
              <span>Source: {q.sourceType}</span>
              <span className="text-muted-foreground/50">ID: {q.id}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Highlight search text
// ---------------------------------------------------------------------------
function HighlightText({ text, highlight }: { text: string; highlight: string }) {
  if (!highlight) return <>{text}</>;
  try {
    const regex = new RegExp(`(${highlight.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
    const parts = text.split(regex);
    return (
      <>
        {parts.map((part, i) =>
          regex.test(part) ? (
            <mark key={i} className="bg-yellow-200 rounded px-0.5">{part}</mark>
          ) : (
            <span key={i}>{part}</span>
          )
        )}
      </>
    );
  } catch {
    return <>{text}</>;
  }
}
