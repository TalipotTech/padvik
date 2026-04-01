"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  BookOpen,
  ChevronRight,
  FileText,
  Layers,
  Search,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Skeleton } from "@/components/ui/skeleton";
import { useBoardSelection } from "@/hooks/use-board-selection";
import {
  getMockSubjects,
  getMockSubjectWithChapters,
} from "@/lib/mock-data";
import type { Subject, ChapterWithTopics } from "@/types/curriculum";

export function SyllabusExplorer() {
  const { boardId, boardName, grade } = useBoardSelection();
  const searchParams = useSearchParams();
  const preSelectedSubjectId = searchParams.get("subjectId");

  const [selectedSubjectId, setSelectedSubjectId] = useState<number | null>(
    preSelectedSubjectId ? Number(preSelectedSubjectId) : null,
  );
  const [searchQuery, setSearchQuery] = useState("");

  const subjects = boardId && grade ? getMockSubjects(boardId, grade) : [];
  const subjectData = selectedSubjectId
    ? getMockSubjectWithChapters(selectedSubjectId)
    : null;

  // Filter chapters/topics by search
  const filteredChapters = useMemo(() => {
    if (!subjectData?.chapters) return [];
    if (!searchQuery.trim()) return subjectData.chapters;

    const q = searchQuery.toLowerCase();
    return subjectData.chapters
      .map((ch) => ({
        ...ch,
        topics: ch.topics.filter(
          (t) =>
            t.title.toLowerCase().includes(q) ||
            ch.title.toLowerCase().includes(q),
        ),
      }))
      .filter((ch) => ch.topics.length > 0 || ch.title.toLowerCase().includes(q));
  }, [subjectData, searchQuery]);

  // No board selected
  if (!boardId || !grade) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <BookOpen className="h-12 w-12 text-muted-foreground/50 mb-4" />
        <h2 className="text-lg font-semibold">No board selected</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Go to the dashboard and select your board & class first.
        </p>
        <Button asChild className="mt-4">
          <Link href="/dashboard">Go to Dashboard</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 pt-2">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Syllabus Explorer</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {boardName} · Class {grade}
        </p>
      </div>

      <div className="flex flex-col gap-6 lg:flex-row">
        {/* Subject list (sidebar on desktop, top on mobile) */}
        <div className="w-full lg:w-64 shrink-0 space-y-2">
          <p className="text-sm font-medium text-muted-foreground px-1">Subjects</p>
          <div className="flex flex-row lg:flex-col gap-2 overflow-x-auto lg:overflow-visible pb-2 lg:pb-0">
            {subjects.map((sub) => (
              <button
                key={sub.id}
                onClick={() => {
                  setSelectedSubjectId(sub.id);
                  setSearchQuery("");
                }}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors whitespace-nowrap min-h-11 ${
                  selectedSubjectId === sub.id
                    ? "border-primary bg-primary/5 text-primary"
                    : "border-border hover:border-primary/50 hover:bg-accent text-foreground"
                }`}
              >
                <Layers className="h-4 w-4 shrink-0" />
                {sub.name}
              </button>
            ))}
          </div>
        </div>

        {/* Chapter/topic detail */}
        <div className="flex-1 min-w-0">
          {!selectedSubjectId ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
                <BookOpen className="h-10 w-10 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">
                  Select a subject to explore chapters and topics
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search chapters & topics..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>

              {/* Chapters accordion */}
              {filteredChapters.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No matching chapters or topics found.
                </p>
              ) : (
                <Accordion
                  type="multiple"
                  defaultValue={filteredChapters.map((c) => String(c.id))}
                  className="space-y-2"
                >
                  {filteredChapters.map((chapter) => (
                    <AccordionItem
                      key={chapter.id}
                      value={String(chapter.id)}
                      className="rounded-lg border bg-card px-4"
                    >
                      <AccordionTrigger className="py-3 hover:no-underline">
                        <div className="flex items-center gap-3 text-left">
                          <Badge
                            variant="outline"
                            className="shrink-0 text-xs font-mono"
                          >
                            Ch {chapter.chapterNumber}
                          </Badge>
                          <span className="font-medium">{chapter.title}</span>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent className="pb-3">
                        <div className="space-y-1 pl-1">
                          {chapter.topics.map((topic) => (
                            <Link
                              key={topic.id}
                              href={`/dashboard/syllabus/${topic.id}`}
                              className="flex items-center justify-between gap-2 rounded-md px-3 py-2 text-sm hover:bg-accent transition-colors group min-h-10"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                                <span className="truncate">{topic.title}</span>
                              </div>
                              <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                            </Link>
                          ))}
                          {chapter.topics.length === 0 && (
                            <p className="text-xs text-muted-foreground px-3 py-2">
                              No topics available yet.
                            </p>
                          )}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
