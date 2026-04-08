"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Search,
  FileText,
  Filter,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  CheckCircle,
  BookOpen,
  Hash,
  BarChart3,
  Loader2,
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
import { MarkdownRenderer } from "@/components/content/markdown-renderer";
import { QuestionImages, parseQuestionImages } from "@/components/content/question-images";

// ---- Types ----
interface SubjectEntry {
  subjectId: number;
  subjectName: string;
  subjectCode: string;
  grade: number;
  questionCount: number;
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
  tags: string[] | null;
  bloomLevel: string | null;
  sourcePaperId: number | null;
  sourcePaperTitle: string | null;
  sourcePaperUrl: string | null;
  questionImages: unknown[] | null;
}

interface TopicGroup {
  title: string;
  questionCount: number;
  questions: Question[];
}

interface ChapterGroup {
  chapterNumber: number | null;
  title: string;
  questionCount: number;
  topics: TopicGroup[];
}

interface Stats {
  totalQuestions: number;
  totalPapers: number;
  mcqCount: number;
  shortCount: number;
  longCount: number;
  easyCount: number;
  mediumCount: number;
  hardCount: number;
}

interface Paper {
  id: number;
  paperTitle: string;
  paperYear: number;
  paperType: string;
  sourceUrl: string | null;
  questionCount: number;
  parsingStatus: string;
}

interface ExplorerData {
  board: { id: number; code: string; name: string } | null;
  subjects: SubjectEntry[];
  chapters: ChapterGroup[];
  papers: Paper[];
  stats: Stats;
}

const BOARDS = ["CBSE", "ICSE", "KL_SCERT"];
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

export function QuestionViewer() {
  const [boardCode, setBoardCode] = useState("CBSE");
  const [grade, setGrade] = useState("10");
  const [subjectSearch, setSubjectSearch] = useState("");
  const [selectedSubjectId, setSelectedSubjectId] = useState<string>("");
  const [search, setSearch] = useState("");
  const [questionType, setQuestionType] = useState("all");
  const [difficulty, setDifficulty] = useState("all");
  const [showFilters, setShowFilters] = useState(false);
  const [data, setData] = useState<ExplorerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedChapters, setExpandedChapters] = useState<Set<string>>(new Set());
  const [expandedQuestions, setExpandedQuestions] = useState<Set<number>>(new Set());

  const fetchData = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ boardCode });
    if (grade !== "all") params.set("grade", grade);
    if (selectedSubjectId) params.set("subjectId", selectedSubjectId);
    if (search) params.set("search", search);
    if (questionType !== "all") params.set("questionType", questionType);
    if (difficulty !== "all") params.set("difficulty", difficulty);

    try {
      const res = await fetch(`/api/admin/question-explorer?${params}`);
      const body = await res.json();
      if (body.success) setData(body.data);
    } catch {
      // Handle silently
    } finally {
      setLoading(false);
    }
  }, [boardCode, grade, selectedSubjectId, search, questionType, difficulty]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Auto-select first subject
  useEffect(() => {
    if (data?.subjects.length && !selectedSubjectId) {
      setSelectedSubjectId(String(data.subjects[0].subjectId));
    }
  }, [data?.subjects, selectedSubjectId]);

  const toggleChapter = (title: string) => {
    setExpandedChapters((prev) => {
      const next = new Set(prev);
      next.has(title) ? next.delete(title) : next.add(title);
      return next;
    });
  };

  const toggleQuestion = (id: number) => {
    setExpandedQuestions((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const expandAll = () => {
    if (data?.chapters) {
      setExpandedChapters(new Set(data.chapters.map((c) => c.title)));
    }
  };
  const collapseAll = () => setExpandedChapters(new Set());

  const stats = data?.stats;
  const totalQ = stats?.totalQuestions ?? 0;

  return (
    <div className="space-y-4">
      {/* ---- Filter Bar ---- */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <span className="text-xs text-muted-foreground">Board</span>
          <Select value={boardCode} onValueChange={(v) => { setBoardCode(v); setSelectedSubjectId(""); }}>
            <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {BOARDS.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <span className="text-xs text-muted-foreground">Grade</span>
          <Select value={grade} onValueChange={(v) => { setGrade(v); setSelectedSubjectId(""); }}>
            <SelectTrigger className="w-[110px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {Array.from({ length: 12 }, (_, i) => (
                <SelectItem key={i + 1} value={String(i + 1)}>Class {i + 1}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="relative flex-1 min-w-[200px]">
          <span className="text-xs text-muted-foreground block mb-1">Search</span>
          <Search className="absolute left-3 top-[calc(50%+2px)] h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search question text..."
            className="pl-10"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button variant="outline" size="icon" className="self-end" onClick={() => setShowFilters(!showFilters)}>
          <Filter className="h-4 w-4" />
        </Button>
      </div>

      {showFilters && (
        <div className="flex gap-3">
          <Select value={questionType} onValueChange={setQuestionType}>
            <SelectTrigger className="w-[140px]"><SelectValue placeholder="Type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="mcq">MCQ</SelectItem>
              <SelectItem value="short_answer">Short Answer</SelectItem>
              <SelectItem value="long_answer">Long Answer</SelectItem>
              <SelectItem value="fill_blank">Fill Blank</SelectItem>
              <SelectItem value="true_false">True/False</SelectItem>
            </SelectContent>
          </Select>
          <Select value={difficulty} onValueChange={setDifficulty}>
            <SelectTrigger className="w-[130px]"><SelectValue placeholder="Difficulty" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="easy">Easy</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="hard">Hard</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {/* ---- Stats Row ---- */}
      {stats && totalQ > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
          <StatCard label="Total" value={totalQ} icon={Hash} />
          <StatCard label="Papers" value={stats.totalPapers} icon={FileText} />
          <StatCard label="MCQ" value={stats.mcqCount} icon={CheckCircle} color="text-blue-600" />
          <StatCard label="Short" value={stats.shortCount} icon={BookOpen} color="text-violet-600" />
          <StatCard label="Long" value={stats.longCount} icon={FileText} color="text-orange-600" />
          <StatCard label="Easy" value={stats.easyCount} color="text-green-600" />
          <StatCard label="Medium" value={stats.mediumCount} color="text-yellow-600" />
          <StatCard label="Hard" value={stats.hardCount} color="text-red-600" />
        </div>
      )}

      {/* ---- Two-column layout: Subject sidebar + Questions ---- */}
      <div className="flex gap-4">
        {/* Left sidebar: Subject list */}
        {(data?.subjects ?? []).length > 0 && (
          <div className="w-[260px] shrink-0 hidden lg:block">
            <Card className="sticky top-4">
              <CardContent className="p-0">
                <div className="px-3 py-2 border-b space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">
                    Subjects ({data?.subjects.length})
                  </p>
                  <Input
                    placeholder="Filter subjects..."
                    className="h-7 text-xs"
                    value={subjectSearch}
                    onChange={(e) => setSubjectSearch(e.target.value)}
                  />
                </div>
                <ScrollArea className="max-h-[calc(100vh-320px)]">
                  <div className="py-1">
                    {data?.subjects.filter((s) =>
                      !subjectSearch || s.subjectName.toLowerCase().includes(subjectSearch.toLowerCase())
                    ).map((s) => {
                      const isSelected = String(s.subjectId) === selectedSubjectId;
                      return (
                        <button
                          key={s.subjectId}
                          className={`w-full text-left px-3 py-2 text-sm transition-colors flex items-center justify-between gap-2 ${
                            isSelected
                              ? "bg-violet-50 text-violet-700 border-l-2 border-violet-600"
                              : "text-foreground hover:bg-muted/50 border-l-2 border-transparent"
                          }`}
                          onClick={() => setSelectedSubjectId(String(s.subjectId))}
                        >
                          <span className="truncate font-medium text-xs">
                            {s.subjectName}
                          </span>
                          <Badge
                            variant={isSelected ? "default" : "secondary"}
                            className="text-[10px] shrink-0 px-1.5"
                          >
                            {s.questionCount}
                          </Badge>
                        </button>
                      );
                    })}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Mobile subject selector (visible on small screens) */}
        <div className="lg:hidden w-full mb-2">
          {(data?.subjects ?? []).length > 0 && (
            <Select value={selectedSubjectId} onValueChange={setSelectedSubjectId}>
              <SelectTrigger>
                <SelectValue placeholder="Select subject" />
              </SelectTrigger>
              <SelectContent>
                {data?.subjects.map((s) => (
                  <SelectItem key={s.subjectId} value={String(s.subjectId)}>
                    {s.subjectName} ({s.questionCount} Q)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {/* Right panel: Questions */}
        <div className="flex-1 min-w-0">
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-20 w-full" />)}
            </div>
          ) : !data?.chapters.length ? (
            <Card>
              <CardContent className="py-16 text-center text-muted-foreground">
                <BarChart3 className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p className="font-medium">No questions found</p>
                <p className="text-xs mt-1">
                  {selectedSubjectId
                    ? "Select a different subject or adjust filters"
                    : "Select a subject to view its questions"}
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {/* Controls */}
              <div className="flex items-center gap-2 text-xs">
                <Button variant="ghost" size="sm" className="text-xs" onClick={expandAll}>
                  Expand All
                </Button>
                <Button variant="ghost" size="sm" className="text-xs" onClick={collapseAll}>
                  Collapse All
                </Button>
                <span className="ml-auto text-muted-foreground">
                  {data.chapters.reduce((s, c) => s + c.questionCount, 0)} questions in{" "}
                  {data.chapters.length} chapters
                </span>
              </div>

              {/* Chapter → Topic → Questions */}
              {data.chapters.map((chapter) => {
                const isExpanded = expandedChapters.has(chapter.title);
                return (
                  <Card key={chapter.title}>
                    <div
                      className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors"
                      onClick={() => toggleChapter(chapter.title)}
                    >
                      {isExpanded ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium">
                          {chapter.chapterNumber ? `${chapter.chapterNumber}. ` : ""}
                          {chapter.title}
                        </span>
                      </div>
                      <Badge variant="secondary" className="text-xs shrink-0">
                        {chapter.questionCount} Q
                      </Badge>
                    </div>

                    {isExpanded && (
                      <div className="border-t">
                        {chapter.topics.map((topic) => (
                          <div key={topic.title} className="border-b last:border-b-0">
                            <div className="px-6 py-2 bg-muted/20 flex items-center gap-2">
                              <BookOpen className="h-3 w-3 text-muted-foreground" />
                              <span className="text-xs font-medium text-muted-foreground">{topic.title}</span>
                              <Badge variant="outline" className="text-[10px] ml-auto">{topic.questionCount}</Badge>
                            </div>
                            <div className="divide-y">
                              {topic.questions.map((q) => (
                                <QuestionRow
                                  key={q.id}
                                  question={q}
                                  expanded={expandedQuestions.has(q.id)}
                                  onToggle={() => toggleQuestion(q.id)}
                                  searchHighlight={search}
                                />
                              ))}
                            </div>
                          </div>
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
    </div>
  );
}

// ---- Sub Components ----

function StatCard({ label, value, icon: Icon, color }: {
  label: string;
  value: number;
  icon?: React.ComponentType<{ className?: string }>;
  color?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-3 pb-2 px-3 flex items-center gap-2">
        {Icon && <Icon className={`h-3.5 w-3.5 ${color ?? "text-muted-foreground"}`} />}
        <div>
          <p className="text-lg font-bold leading-none">{value}</p>
          <p className="text-[10px] text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

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
  const highlightText = (text: string) => {
    if (!searchHighlight) return text;
    const regex = new RegExp(`(${searchHighlight.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
    const parts = text.split(regex);
    return parts.map((part, i) =>
      regex.test(part) ? (
        <mark key={i} className="bg-yellow-200 rounded px-0.5">{part}</mark>
      ) : (
        part
      )
    );
  };

  return (
    <div className="px-6 py-2.5 hover:bg-muted/10 transition-colors">
      <div className="flex items-start gap-2 cursor-pointer" onClick={onToggle}>
        {/* Question number */}
        <span className="text-xs text-muted-foreground font-mono min-w-[2rem] pt-0.5">
          {q.questionNumber ?? "Q"}
        </span>

        {/* Badges */}
        <div className="flex gap-1 shrink-0 pt-0.5">
          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
            {TYPE_LABELS[q.questionType] ?? q.questionType}
          </Badge>
          <Badge variant="secondary" className={`text-[10px] px-1.5 py-0 ${DIFFICULTY_COLORS[q.difficulty] ?? ""}`}>
            {q.difficulty}
          </Badge>
          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
            {parseFloat(q.marks)}m
          </Badge>
          {q.language !== "en" && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
              {q.language}
            </Badge>
          )}
        </div>

        {/* Question text (truncated) */}
        <p className="text-sm flex-1 leading-relaxed">
          {expanded
            ? highlightText(q.questionText)
            : highlightText(q.questionText.length > 150 ? q.questionText.slice(0, 150) + "..." : q.questionText)}
        </p>

        {expanded ? <ChevronUp className="h-3 w-3 shrink-0 mt-1" /> : <ChevronDown className="h-3 w-3 shrink-0 mt-1" />}
      </div>

      {expanded && (
        <div className="ml-[2rem] mt-2 space-y-2 text-sm">
          {/* Full question text */}
          {q.questionText.length > 150 && (
            <p className="whitespace-pre-wrap leading-relaxed">{highlightText(q.questionText)}</p>
          )}

          {/* Question images (figures, diagrams) */}
          {q.questionImages && q.questionImages.length > 0 && (
            <QuestionImages images={parseQuestionImages(q.questionImages)} compact />
          )}

          {/* MCQ options */}
          {q.options && q.options.length > 0 && (
            <div className="space-y-1 ml-2">
              {q.options.map((opt) => (
                <div
                  key={opt.label}
                  className={`flex items-start gap-2 text-xs px-2 py-0.5 rounded ${
                    opt.isCorrect ? "bg-green-50 text-green-800 font-medium" : ""
                  }`}
                >
                  <span className="text-muted-foreground min-w-[1.2rem]">{opt.label})</span>
                  <span>{opt.text}</span>
                  {opt.isCorrect && <CheckCircle className="h-3 w-3 text-green-600 ml-auto shrink-0" />}
                </div>
              ))}
            </div>
          )}

          {/* Answer */}
          {q.correctAnswer && (
            <div className="bg-green-50 border border-green-200 rounded p-2">
              <p className="text-xs font-medium text-green-800 mb-0.5">Answer</p>
              <MarkdownRenderer content={q.correctAnswer} className="text-xs text-green-900 [&_p]:m-0" />
            </div>
          )}

          {/* Solution */}
          {q.solution && (
            <div className="bg-blue-50 border border-blue-200 rounded p-2">
              <p className="text-xs font-medium text-blue-800 mb-0.5">Solution</p>
              <MarkdownRenderer content={q.solution} className="text-xs text-blue-900 [&_p]:m-0" />
            </div>
          )}

          {/* Meta row */}
          <div className="flex flex-wrap gap-2 text-[10px] text-muted-foreground">
            {q.bloomLevel && <span>Bloom: {q.bloomLevel}</span>}
            {q.sectionLabel && <span>Section: {q.sectionLabel}</span>}
            <span>Source: {q.sourceType}</span>
            {q.tags && q.tags.length > 0 && <span>Tags: {q.tags.join(", ")}</span>}
            <span>ID: {q.id}</span>
            {q.sourcePaperUrl && (
              <a
                href={q.sourcePaperUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-violet-600 hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                View PDF
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
