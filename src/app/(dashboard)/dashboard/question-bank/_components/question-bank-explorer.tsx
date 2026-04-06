"use client";

import { useState, useCallback } from "react";
import { Search, Filter } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useData } from "@/hooks/use-data";
import { apiFetch } from "@/lib/api-client";
import { QuestionCard } from "./question-card";
import { CurriculumFilterBar, type CurriculumFilter } from "./curriculum-filter-bar";

interface Question {
  id: number;
  topicId: number;
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

interface QuestionsResponse {
  questions: Question[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export function QuestionBankExplorer() {
  const [curriculumFilter, setCurriculumFilter] = useState<CurriculumFilter>({
    subjectId: "",
    chapterId: "",
    topicId: "",
  });
  const [search, setSearch] = useState("");
  const [questionType, setQuestionType] = useState("all");
  const [difficulty, setDifficulty] = useState("all");
  const [sourceType, setSourceType] = useState("all");
  const [page, setPage] = useState(1);
  const [showFilters, setShowFilters] = useState(false);

  const handleFilterChange = (filter: CurriculumFilter) => {
    setCurriculumFilter(filter);
    setPage(1);
  };

  const buildUrl = useCallback(() => {
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("limit", "20");
    if (search) params.set("search", search);
    if (questionType !== "all") params.set("questionType", questionType);
    if (difficulty !== "all") params.set("difficulty", difficulty);
    if (sourceType !== "all") params.set("sourceType", sourceType);
    // Curriculum filters — most specific wins
    const { subjectId, chapterId, topicId } = curriculumFilter;
    if (topicId && topicId !== "all") {
      params.set("topicId", topicId);
    } else if (chapterId && chapterId !== "all") {
      params.set("chapterId", chapterId);
    } else if (subjectId && subjectId !== "all") {
      params.set("subjectId", subjectId);
    }
    return `/api/questions?${params.toString()}`;
  }, [page, search, questionType, difficulty, sourceType, curriculumFilter]);

  const { data, loading, refetch } = useData<QuestionsResponse>(
    () => apiFetch<QuestionsResponse>(buildUrl()),
    [buildUrl]
  );

  const handleSearch = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  return (
    <div className="space-y-4">
      {/* Curriculum filter bar */}
      <CurriculumFilterBar onFilterChange={handleFilterChange} />

      {/* Search and filters */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search questions..."
            className="pl-10"
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
          />
        </div>
        <Button
          variant="outline"
          size="icon"
          onClick={() => setShowFilters(!showFilters)}
        >
          <Filter className="h-4 w-4" />
        </Button>
      </div>

      {showFilters && (
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Select value={questionType} onValueChange={(v) => { setQuestionType(v); setPage(1); }}>
                <SelectTrigger>
                  <SelectValue placeholder="Question Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="mcq">MCQ</SelectItem>
                  <SelectItem value="short_answer">Short Answer</SelectItem>
                  <SelectItem value="long_answer">Long Answer</SelectItem>
                  <SelectItem value="fill_blank">Fill in the Blank</SelectItem>
                  <SelectItem value="true_false">True/False</SelectItem>
                </SelectContent>
              </Select>

              <Select value={difficulty} onValueChange={(v) => { setDifficulty(v); setPage(1); }}>
                <SelectTrigger>
                  <SelectValue placeholder="Difficulty" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Difficulties</SelectItem>
                  <SelectItem value="easy">Easy</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="hard">Hard</SelectItem>
                </SelectContent>
              </Select>

              <Select value={sourceType} onValueChange={(v) => { setSourceType(v); setPage(1); }}>
                <SelectTrigger>
                  <SelectValue placeholder="Source" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Sources</SelectItem>
                  <SelectItem value="scraped">Scraped (Official)</SelectItem>
                  <SelectItem value="user_uploaded">My Questions</SelectItem>
                  <SelectItem value="ai_generated">AI Generated</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Results */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      ) : data?.questions.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No questions found. Try selecting a subject or adjusting filters.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {data?.questions.map((q) => (
            <QuestionCard key={q.id} question={q} onUpdate={refetch} />
          ))}
        </div>
      )}

      {/* Pagination */}
      {data && data.pagination.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Showing {(data.pagination.page - 1) * data.pagination.limit + 1}-
            {Math.min(
              data.pagination.page * data.pagination.limit,
              data.pagination.total
            )}{" "}
            of {data.pagination.total} questions
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= data.pagination.totalPages}
              onClick={() => setPage(page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
