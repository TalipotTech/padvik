"use client";

import Link from "next/link";
import { ArrowLeft, BookOpen, Clock, FileText } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MarkdownRenderer } from "@/components/content/markdown-renderer";
import { getMockTopic, getMockContentForTopic } from "@/lib/mock-data";

interface TopicDetailProps {
  topicId: number;
}

export function TopicDetail({ topicId }: TopicDetailProps) {
  const topic = getMockTopic(topicId);
  const contentItems = getMockContentForTopic(topicId);

  if (!topic) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <FileText className="h-12 w-12 text-muted-foreground/50 mb-4" />
        <h2 className="text-lg font-semibold">Topic not found</h2>
        <p className="text-sm text-muted-foreground mt-1">
          This topic doesn&apos;t exist or hasn&apos;t been added yet.
        </p>
        <Button asChild className="mt-4" variant="outline">
          <Link href="/dashboard/syllabus">Back to Syllabus</Link>
        </Button>
      </div>
    );
  }

  const notes = contentItems.filter((c) => c.contentType === "notes");
  const summaries = contentItems.filter((c) => c.contentType === "summary");
  const allContent = [...notes, ...summaries];

  return (
    <div className="space-y-6 pt-2">
      {/* Back link + header */}
      <div>
        <Button variant="ghost" size="sm" asChild className="mb-2 -ml-2">
          <Link href="/dashboard/syllabus" className="flex items-center gap-1">
            <ArrowLeft className="h-4 w-4" />
            Back to Syllabus
          </Link>
        </Button>

        <h1 className="text-2xl font-bold text-foreground">{topic.title}</h1>

        <div className="flex flex-wrap items-center gap-2 mt-2">
          <Badge variant="secondary" className="text-xs">
            <BookOpen className="h-3 w-3 mr-1" />
            {topic.subject.name}
          </Badge>
          <Badge variant="outline" className="text-xs">
            Ch {topic.chapter.chapterNumber} · {topic.chapter.title}
          </Badge>
          {topic.estimatedMinutes && (
            <Badge variant="outline" className="text-xs">
              <Clock className="h-3 w-3 mr-1" />
              ~{topic.estimatedMinutes} min
            </Badge>
          )}
        </div>

        {topic.description && (
          <p className="text-sm text-muted-foreground mt-3">{topic.description}</p>
        )}
      </div>

      <Separator />

      {/* Content tabs */}
      {allContent.length > 0 ? (
        <Tabs defaultValue="notes" className="space-y-4">
          <TabsList>
            <TabsTrigger value="notes">
              Notes {notes.length > 0 && `(${notes.length})`}
            </TabsTrigger>
            <TabsTrigger value="summary">
              Summary {summaries.length > 0 && `(${summaries.length})`}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="notes" className="space-y-4">
            {notes.length === 0 ? (
              <EmptyContent type="notes" />
            ) : (
              notes.map((item) => (
                <ContentCard key={item.id} item={item} />
              ))
            )}
          </TabsContent>

          <TabsContent value="summary" className="space-y-4">
            {summaries.length === 0 ? (
              <EmptyContent type="summaries" />
            ) : (
              summaries.map((item) => (
                <ContentCard key={item.id} item={item} />
              ))
            )}
          </TabsContent>
        </Tabs>
      ) : (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <FileText className="h-10 w-10 text-muted-foreground/40" />
            <div>
              <p className="font-medium">No content yet</p>
              <p className="text-sm text-muted-foreground mt-1">
                Content for this topic is being prepared. Check back soon!
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ContentCard({ item }: { item: { id: number; title: string; body: string | null; sourceType: string; qualityScore: string | null } }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">{item.title}</CardTitle>
          <div className="flex gap-1.5 shrink-0">
            {item.sourceType === "ai_generated" && (
              <Badge variant="secondary" className="text-xs">AI</Badge>
            )}
            {item.qualityScore !== null && (
              <Badge
                variant={parseFloat(item.qualityScore) >= 0.7 ? "success" : "outline"}
                className="text-xs"
              >
                {Math.round(parseFloat(item.qualityScore) * 100)}%
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {item.body ? (
          <MarkdownRenderer content={item.body} />
        ) : (
          <p className="text-sm text-muted-foreground italic">
            Content body not available.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function EmptyContent({ type }: { type: string }) {
  return (
    <div className="rounded-lg border border-dashed p-8 text-center">
      <p className="text-sm text-muted-foreground">
        No {type} available for this topic yet.
      </p>
    </div>
  );
}
