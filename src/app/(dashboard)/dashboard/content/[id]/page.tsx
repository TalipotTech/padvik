"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MarkdownRenderer } from "@/components/content/markdown-renderer";
import {
  Loader2, ArrowLeft, Eye, FileText, FileVideo, FileAudio,
  Image as ImageIcon, BookOpen, Download,
} from "lucide-react";

interface ContentDetail {
  id: number; contentType: string; title: string; description: string | null;
  body: string | null; mediaUrl: string | null; thumbnailUrl: string | null;
  viewCount: number; likeCount: number; isPublished: boolean;
  aiSummary: string | null; aiTags: string[] | null;
  boardName: string | null; subjectName: string | null;
  chapterTitle: string | null; topicTitle: string | null;
  createdAt: string;
}

function ContentTypeIcon({ type, className }: { type: string; className?: string }) {
  const cls = className || "h-5 w-5";
  switch (type) {
    case "video": return <FileVideo className={`${cls} text-blue-500`} />;
    case "audio": return <FileAudio className={`${cls} text-green-500`} />;
    case "image": return <ImageIcon className={`${cls} text-amber-500`} />;
    default: return <FileText className={`${cls} text-violet-500`} />;
  }
}

export default function StudentContentViewPage() {
  const params = useParams();
  const [content, setContent] = useState<ContentDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Track view
    fetch(`/api/content/${params.id}/view`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => {});

    // Fetch content detail
    fetch(`/api/creators/content/${params.id}`)
      .then(r => r.json())
      .then(res => { if (res.success) setContent(res.data); })
      .finally(() => setLoading(false));
  }, [params.id]);

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
  if (!content) return <p className="text-center py-10 text-muted-foreground">Content not found.</p>;

  const curriculum = [content.boardName, content.subjectName, content.chapterTitle, content.topicTitle].filter(Boolean).join(" › ");

  return (
    <div className="max-w-4xl space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => history.back()}><ArrowLeft className="h-4 w-4" /></Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold">{content.title}</h1>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <ContentTypeIcon type={content.contentType} />
            <Badge variant="outline" className="capitalize">{content.contentType}</Badge>
            <span className="text-xs text-muted-foreground"><Eye className="h-3 w-3 inline mr-0.5" />{content.viewCount} views</span>
            <span className="text-xs text-muted-foreground">{new Date(content.createdAt).toLocaleDateString()}</span>
          </div>
          {curriculum && (
            <div className="flex items-center gap-1.5 mt-1">
              <BookOpen className="h-3.5 w-3.5 text-violet-500" />
              <span className="text-sm text-muted-foreground">{curriculum}</span>
            </div>
          )}
        </div>
      </div>

      {/* AI Summary */}
      {content.aiSummary && (
        <div className="rounded-lg border bg-violet-50/50 dark:bg-violet-950/10 p-4">
          <p className="text-xs font-medium text-violet-600 mb-1">AI Summary</p>
          <p className="text-sm">{content.aiSummary}</p>
        </div>
      )}

      {content.description && <p className="text-sm text-muted-foreground">{content.description}</p>}

      {/* Media content */}
      {content.contentType === "video" && content.mediaUrl && (
        <div className="rounded-lg border bg-black overflow-hidden">
          <video src={content.mediaUrl} controls className="w-full aspect-video" poster={content.thumbnailUrl || undefined} />
        </div>
      )}

      {content.contentType === "audio" && content.mediaUrl && (
        <Card>
          <CardContent className="py-6">
            <audio src={content.mediaUrl} controls className="w-full" />
          </CardContent>
        </Card>
      )}

      {content.contentType === "image" && content.mediaUrl && (
        <div className="rounded-lg border overflow-hidden flex justify-center bg-muted/10 p-4">
          <img src={content.mediaUrl} alt={content.title} className="max-h-[600px] rounded object-contain" />
        </div>
      )}

      {content.contentType === "document" && content.mediaUrl && (
        <Card>
          <CardContent className="py-6 flex flex-col items-center gap-3">
            <FileText className="h-12 w-12 text-red-400" />
            <p className="text-sm font-medium">{content.title}</p>
            <a href={content.mediaUrl} target="_blank" rel="noopener noreferrer">
              <Button variant="outline" className="gap-1.5"><Download className="h-4 w-4" />Open Document</Button>
            </a>
          </CardContent>
        </Card>
      )}

      {/* Text/Note body */}
      {content.body && (
        <Card>
          <CardContent className="py-6">
            <MarkdownRenderer content={content.body} />
          </CardContent>
        </Card>
      )}

      {/* Tags */}
      {content.aiTags && content.aiTags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {content.aiTags.map(tag => (
            <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>
          ))}
        </div>
      )}
    </div>
  );
}
