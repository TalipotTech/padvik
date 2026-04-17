"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Upload, Loader2, Edit, Trash2, Globe, BookOpen, FileText, FileVideo, FileAudio, Image as ImageIcon } from "lucide-react";
import { toast } from "sonner";

interface ContentItem {
  id: number;
  contentType: string;
  title: string;
  description: string | null;
  thumbnailUrl: string | null;
  mediaUrl: string | null;
  isPublished: boolean;
  reviewStatus: string;
  viewCount: number;
  likeCount: number;
  createdAt: string;
  // Curriculum info from joins
  boardName: string | null;
  boardCode: string | null;
  standardGrade: number | null;
  subjectName: string | null;
  chapterTitle: string | null;
  chapterNumber: number | null;
  // Media info
  metadata: { mediaItems?: { type: string }[]; handwritten?: boolean } | null;
}

function ContentTypeIcon({ type, className }: { type: string; className?: string }) {
  const cls = className || "h-5 w-5";
  switch (type) {
    case "video": return <FileVideo className={cls} />;
    case "audio": return <FileAudio className={cls} />;
    case "image": return <ImageIcon className={cls} />;
    default: return <FileText className={cls} />;
  }
}

function CurriculumBadges({ item }: { item: ContentItem }) {
  const parts: string[] = [];
  if (item.boardCode) parts.push(item.boardCode);
  if (item.standardGrade) parts.push(`Class ${item.standardGrade}`);
  if (item.subjectName) parts.push(item.subjectName);
  if (item.chapterTitle) parts.push(`Ch ${item.chapterNumber}: ${item.chapterTitle}`);

  if (parts.length === 0) return null;

  return (
    <div className="flex items-center gap-1 mt-1 flex-wrap">
      <BookOpen className="h-3 w-3 text-muted-foreground shrink-0" />
      <span className="text-[11px] text-muted-foreground">
        {parts.join(" · ")}
      </span>
    </div>
  );
}

export default function CreatorContentPage() {
  const [items, setItems] = useState<ContentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    fetchContent();
  }, [page]);

  async function fetchContent() {
    setLoading(true);
    const res = await fetch(`/api/creators/content?page=${page}&limit=20`);
    const data = await res.json();
    if (data.success) {
      setItems(data.data.items);
      setTotalPages(data.data.pagination.totalPages);
    }
    setLoading(false);
  }

  async function togglePublish(id: number) {
    const res = await fetch(`/api/creators/content/${id}/publish`, { method: "POST" });
    const data = await res.json();
    if (data.success) {
      toast.success(data.data.isPublished ? "Content published" : "Content unpublished");
      fetchContent();
    } else {
      toast.error(data.error?.message || "Failed");
    }
  }

  async function deleteContent(id: number) {
    if (!confirm("Delete this content? This cannot be undone.")) return;
    const res = await fetch(`/api/creators/content/${id}`, { method: "DELETE" });
    const data = await res.json();
    if (data.success) {
      toast.success("Content deleted");
      fetchContent();
    } else {
      toast.error(data.error?.message || "Failed to delete");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">My Content</h1>
        <Link href="/dashboard/creator/content/upload">
          <Button className="gap-2">
            <Upload className="h-4 w-4" />
            Upload New
          </Button>
        </Link>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 gap-4">
            <p className="text-muted-foreground">No content uploaded yet.</p>
            <Link href="/dashboard/creator/content/upload">
              <Button variant="outline" className="gap-2">
                <Upload className="h-4 w-4" />
                Upload Your First Content
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <Card key={item.id}>
              <CardContent className="flex items-center gap-4 py-3">
                {/* Left: Thumbnail/icon */}
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-muted/50 border overflow-hidden">
                  {item.thumbnailUrl ? (
                    <img src={item.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                  ) : item.mediaUrl && item.contentType === "image" ? (
                    <img src={item.mediaUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <ContentTypeIcon type={item.contentType} className="h-6 w-6 text-muted-foreground" />
                  )}
                </div>

                {/* Middle: Info */}
                <div className="flex-1 min-w-0">
                  <Link href={`/dashboard/creator/content/${item.id}`} className="font-medium hover:underline truncate block">
                    {item.title}
                  </Link>
                  <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                    <Badge variant="outline" className="capitalize text-[10px] py-0 h-5">{item.contentType}</Badge>
                    <Badge variant={item.isPublished ? "default" : "secondary"} className="text-[10px] py-0 h-5">
                      {item.isPublished ? "Published" : "Draft"}
                    </Badge>
                    <Badge
                      variant={item.reviewStatus === "approved" ? "default" : item.reviewStatus === "rejected" ? "destructive" : "secondary"}
                      className="text-[10px] py-0 h-5"
                    >
                      {item.reviewStatus}
                    </Badge>
                    {(item.metadata?.mediaItems?.length ?? 0) > 0 && (
                      <Badge variant="outline" className="text-[10px] py-0 h-5">
                        {item.metadata!.mediaItems!.length} file{item.metadata!.mediaItems!.length !== 1 ? "s" : ""}
                      </Badge>
                    )}
                    <span className="text-[10px] text-muted-foreground">{item.viewCount} views · {item.likeCount} likes</span>
                  </div>
                  <CurriculumBadges item={item} />
                </div>

                {/* Right: Date + actions */}
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span className="text-xs text-muted-foreground">{new Date(item.createdAt).toLocaleDateString()}</span>
                  <div className="flex items-center gap-0.5">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => togglePublish(item.id)} title={item.isPublished ? "Unpublish" : "Publish"}>
                      <Globe className="h-3.5 w-3.5" />
                    </Button>
                    <Link href={`/dashboard/creator/content/${item.id}`}>
                      <Button variant="ghost" size="icon" className="h-7 w-7" title="Edit"><Edit className="h-3.5 w-3.5" /></Button>
                    </Link>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => deleteContent(item.id)} title="Delete">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-4">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
              <span className="text-sm text-muted-foreground">Page {page} of {totalPages}</span>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next</Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
