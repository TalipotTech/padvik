"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ContentViewToggle } from "@/components/content/content-view-toggle";
import {
  ArrowLeft, BookOpen, Layers, FileText, ChevronLeft, ChevronRight,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types (subset of LearnView types — only what we need)
// ---------------------------------------------------------------------------

interface TopicData {
  topic: {
    id: number; title: string; description: string | null;
    chapter: { id: number; number: number; title: string };
    subject: { id: number; name: string; code: string };
    grade: number;
    /** Session label threaded from standards.academic_year; displayed in the
     * Rich view's breadcrumb alongside class + subject. */
    academicYear: string;
    board: { code: string; name: string };
  };
  content: Array<{
    id: number; title: string; body: string; contentType: string;
    sourceType: string; language: string; qualityScore: string | null;
    metadata: Record<string, unknown> | null;
  }>;
  pendingContent: Array<{
    id: number; title: string; body: string; contentType: string;
    sourceType: string; qualityScore: string | null; language: string;
    metadata: Record<string, unknown> | null;
  }>;
  navigation: {
    prev: { id: number; title: string } | null;
    next: { id: number; title: string } | null;
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RichLearnView({ topicId }: { topicId: number }) {
  const [data, setData] = useState<TopicData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/learn/topic/${topicId}`);
        if (res.ok) {
          const json = await res.json();
          setData(json.data ?? json);
        }
      } catch (err) {
        console.error("Failed to load topic:", err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [topicId]);

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto p-6 space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="max-w-4xl mx-auto p-6 text-center py-20">
        <p className="text-muted-foreground">Topic not found</p>
        <Link href={`/dashboard/learn/${topicId}`}>
          <Button variant="outline" className="mt-4">Back to standard view</Button>
        </Link>
      </div>
    );
  }

  const { topic, navigation } = data;
  const allContent = [...data.content, ...data.pendingContent];
  const richContent = allContent.filter(
    (ci) => ci.contentType === "rich_note" || (ci.metadata?.richBlocks && Array.isArray(ci.metadata.richBlocks))
  );
  const standardContent = allContent.filter(
    (ci) => ci.contentType !== "rich_note" && (!ci.metadata?.richBlocks || !Array.isArray(ci.metadata.richBlocks))
  );

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-6">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <Link href={`/dashboard/learn/${topicId}`}>
          <Button variant="ghost" size="sm" className="gap-1.5">
            <ArrowLeft className="h-4 w-4" />
            Standard View
          </Button>
        </Link>
        <Badge variant="secondary" className="gap-1">
          <Layers className="h-3 w-3" />
          Rich View
        </Badge>
      </div>

      {/* Topic info */}
      <div className="mb-6">
        <div className="text-xs text-muted-foreground mb-1">
          {topic.board.code} &middot; Class {topic.grade}
          {topic.academicYear ? ` · ${topic.academicYear}` : ""} &middot; {topic.subject.name} &middot; Ch {topic.chapter.number}
        </div>
        <h1 className="text-2xl font-bold">{topic.title}</h1>
        {topic.description && (
          <p className="text-sm text-muted-foreground mt-1">{topic.description}</p>
        )}
      </div>

      {/* Rich content items */}
      {richContent.length > 0 ? (
        <div className="space-y-8">
          {richContent.map((ci) => (
            <Card key={ci.id}>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <CardTitle className="text-base">{ci.title}</CardTitle>
                  <Badge variant="secondary" className="text-[10px]">
                    {ci.sourceType === "ncert_rich" ? "NCERT Rich" : ci.sourceType}
                  </Badge>
                  {ci.qualityScore && (
                    <Badge variant="outline" className="text-[10px]">
                      {Math.round(parseFloat(ci.qualityScore) * 100)}%
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <ContentViewToggle content={ci} />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center py-16 text-center">
            <Layers className="h-10 w-10 text-muted-foreground/40 mb-4" />
            <p className="font-medium">No rich content yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              Rich content with images hasn&apos;t been extracted for this topic.
            </p>
            <Link href={`/dashboard/learn/${topicId}`}>
              <Button variant="outline" className="mt-4 gap-1.5">
                <FileText className="h-4 w-4" />
                View text-only content
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {/* Also show standard content if any */}
      {standardContent.length > 0 && richContent.length > 0 && (
        <div className="mt-8">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <FileText className="h-5 w-5 text-muted-foreground" />
            Text-only Content
          </h2>
          <div className="space-y-4">
            {standardContent.map((ci) => (
              <Card key={ci.id}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">{ci.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <ContentViewToggle content={ci} />
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Navigation */}
      <div className="flex justify-between mt-8 pt-4 border-t">
        {navigation.prev ? (
          <Link href={`/dashboard/learn/${navigation.prev.id}/rich`}>
            <Button variant="outline" size="sm" className="gap-1">
              <ChevronLeft className="h-4 w-4" />
              {navigation.prev.title}
            </Button>
          </Link>
        ) : <div />}
        {navigation.next ? (
          <Link href={`/dashboard/learn/${navigation.next.id}/rich`}>
            <Button variant="outline" size="sm" className="gap-1">
              {navigation.next.title}
              <ChevronRight className="h-4 w-4" />
            </Button>
          </Link>
        ) : <div />}
      </div>
    </div>
  );
}
