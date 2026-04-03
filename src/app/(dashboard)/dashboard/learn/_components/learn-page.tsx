"use client";

import Link from "next/link";
import { BookOpen, FileText, GraduationCap } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useBoardSelection } from "@/hooks/use-board-selection";
import { useData } from "@/hooks/use-data";
import { getSubjects } from "@/lib/data";

export function LearnPage() {
  const { boardId, boardName, grade } = useBoardSelection();
  const { data: subjects, loading: subjectsLoading } = useData(
    () => boardId && grade ? getSubjects(boardId, grade) : Promise.resolve([]),
    [boardId, grade],
  );
  // Derive flat topic list from subjects hierarchy
  const topics = (subjects ?? []).flatMap((s) =>
    s.chapters.flatMap((c) => c.topics),
  );

  if (!boardId || !grade) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <GraduationCap className="h-12 w-12 text-muted-foreground/50 mb-4" />
        <h2 className="text-lg font-semibold">No board selected</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Select your board and class to start learning.
        </p>
        <Button asChild className="mt-4">
          <Link href="/dashboard">Go to Dashboard</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 pt-2">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Learn</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Browse topics with notes and content · {boardName} Class {grade}
        </p>
      </div>

      {/* Topics with content — quick access */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Available Topics</h2>
        {subjectsLoading ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-28 rounded-lg" />
            ))}
          </div>
        ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {topics.slice(0, 12).map((topic) => (
            <Link key={topic.id} href={`/dashboard/syllabus/${topic.id}`}>
              <Card className="hover:border-primary/50 transition-colors cursor-pointer h-full">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">{topic.title}</CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <p className="text-xs text-muted-foreground line-clamp-2">
                    {topic.description || "Explore this topic"}
                  </p>
                  <div className="flex items-center gap-1.5 mt-2">
                    <FileText className="h-3 w-3 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">
                      View notes
                    </span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
        )}
      </div>

      {/* Subjects overview */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">By Subject</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {(subjects ?? []).map((subject) => (
            <Link
              key={subject.id}
              href={`/dashboard/syllabus?subjectId=${subject.id}`}
            >
              <Card className="hover:border-primary/50 transition-colors cursor-pointer">
                <CardContent className="flex items-center gap-3 p-4">
                  <BookOpen className="h-5 w-5 text-primary shrink-0" />
                  <div className="min-w-0">
                    <p className="font-medium text-sm">{subject.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {subject.chapters.length} chapters · {subject.chapters.reduce((sum, ch) => sum + ch.topics.length, 0)} topics
                    </p>
                  </div>
                  <Badge variant="secondary" className="ml-auto text-xs shrink-0">
                    {subject.code}
                  </Badge>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
