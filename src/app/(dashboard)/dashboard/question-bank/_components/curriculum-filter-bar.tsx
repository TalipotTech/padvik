"use client";

import { useState, useEffect } from "react";
import { BookOpen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useBoardSelection } from "@/hooks/use-board-selection";
import { useData } from "@/hooks/use-data";
import { getSubjects } from "@/lib/data";

export interface CurriculumFilter {
  subjectId: string;
  chapterId: string;
  topicId: string;
}

interface CurriculumFilterBarProps {
  /** Called whenever any filter changes */
  onFilterChange: (filter: CurriculumFilter) => void;
  /** Show topic selector (default true). Set false for tabs that don't need topic-level granularity */
  showTopic?: boolean;
  /** Current filter values (controlled mode) */
  value?: CurriculumFilter;
}

export function CurriculumFilterBar({
  onFilterChange,
  showTopic = true,
  value,
}: CurriculumFilterBarProps) {
  const { boardId, boardName, grade } = useBoardSelection();

  const { data: subjects, loading } = useData(
    () => (boardId && grade ? getSubjects(boardId, grade) : Promise.resolve([])),
    [boardId, grade]
  );

  const [subjectId, setSubjectId] = useState(value?.subjectId ?? "");
  const [chapterId, setChapterId] = useState(value?.chapterId ?? "");
  const [topicId, setTopicId] = useState(value?.topicId ?? "");

  // Sync from controlled value
  useEffect(() => {
    if (value) {
      setSubjectId(value.subjectId);
      setChapterId(value.chapterId);
      setTopicId(value.topicId);
    }
  }, [value]);

  const selectedSubject = (subjects ?? []).find((s) => String(s.id) === subjectId);
  const selectedChapter = selectedSubject?.chapters?.find(
    (c: { id: number }) => String(c.id) === chapterId
  );

  const handleSubjectChange = (v: string) => {
    setSubjectId(v);
    setChapterId("");
    setTopicId("");
    onFilterChange({ subjectId: v, chapterId: "", topicId: "" });
  };

  const handleChapterChange = (v: string) => {
    setChapterId(v);
    setTopicId("");
    onFilterChange({ subjectId, chapterId: v, topicId: "" });
  };

  const handleTopicChange = (v: string) => {
    setTopicId(v);
    onFilterChange({ subjectId, chapterId, topicId: v });
  };

  if (!boardId || !grade) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
        <BookOpen className="h-4 w-4" />
        Select a board and grade from the header to get started.
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Board + Grade badges (read-only from board picker) */}
      <Badge variant="secondary" className="text-xs shrink-0">
        {boardName}
      </Badge>
      <Badge variant="outline" className="text-xs shrink-0">
        Class {grade}
      </Badge>

      {/* Subject selector */}
      <Select value={subjectId} onValueChange={handleSubjectChange}>
        <SelectTrigger className="h-8 w-[180px] text-xs">
          <SelectValue placeholder={loading ? "Loading..." : "All Subjects"} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Subjects</SelectItem>
          {(subjects ?? []).map((s) => (
            <SelectItem key={s.id} value={String(s.id)}>
              {s.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Chapter selector (shows when subject selected) */}
      {subjectId && subjectId !== "all" && (selectedSubject?.chapters ?? []).length > 0 && (
        <Select value={chapterId} onValueChange={handleChapterChange}>
          <SelectTrigger className="h-8 w-[200px] text-xs">
            <SelectValue placeholder="All Chapters" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Chapters</SelectItem>
            {(selectedSubject?.chapters ?? []).map((c: { id: number; title: string }) => (
              <SelectItem key={c.id} value={String(c.id)}>
                {c.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Topic selector (shows when chapter selected) */}
      {showTopic && chapterId && chapterId !== "all" && (selectedChapter?.topics ?? []).length > 0 && (
        <Select value={topicId} onValueChange={handleTopicChange}>
          <SelectTrigger className="h-8 w-[200px] text-xs">
            <SelectValue placeholder="All Topics" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Topics</SelectItem>
            {(selectedChapter?.topics ?? []).map((t: { id: number; title: string }) => (
              <SelectItem key={t.id} value={String(t.id)}>
                {t.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

/**
 * Returns the subjects data for use in forms that need the raw data.
 */
export function useCurriculumData() {
  const { boardId, boardName, grade } = useBoardSelection();
  const { data: subjects, loading } = useData(
    () => (boardId && grade ? getSubjects(boardId, grade) : Promise.resolve([])),
    [boardId, grade]
  );
  return { boardId, boardName, grade, subjects, loading };
}
