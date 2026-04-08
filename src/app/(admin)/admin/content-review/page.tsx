"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  CheckCircle2, XCircle, Flag, Loader2, AlertTriangle,
  RefreshCw, ChevronDown, ChevronUp, FileText, Star, Eye,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ReviewItem {
  id: number;
  topicId: number;
  contentType: string;
  title: string;
  body: string;
  bodyFormat: string;
  sourceType: string;
  sourceUrl: string | null;
  language: string;
  qualityScore: string | null;
  reviewStatus: string;
  isPublished: boolean;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  topicTitle: string;
  chapterTitle: string;
  subjectName: string;
  grade: number;
  boardCode: string;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ContentReviewPage() {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("pending");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [actionLoading, setActionLoading] = useState<number | null>(null);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/content-review?status=${statusFilter}&limit=50`);
      const json = await res.json();
      if (json.success) {
        setItems(json.data.items);
        setTotal(json.data.total);
      }
    } catch (err) {
      console.error("Failed to fetch review items:", err);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  const handleAction = async (id: number, action: "approve" | "reject" | "flag") => {
    setActionLoading(id);
    try {
      const res = await fetch("/api/admin/content-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      const json = await res.json();
      if (json.success) {
        setItems((prev) => prev.filter((i) => i.id !== id));
        setTotal((prev) => prev - 1);
      }
    } catch (err) {
      console.error("Review action failed:", err);
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Content Review</h1>
          <p className="text-sm text-muted-foreground">
            {total} items {statusFilter === "pending" ? "awaiting review" : `with status: ${statusFilter}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={fetchItems}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Refresh
          </Button>
        </div>
      </div>

      {/* Status Filter Tabs */}
      <div className="flex gap-1 rounded-lg bg-muted p-1">
        {["pending", "approved", "rejected", "flagged"].map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              statusFilter === s
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {/* Content Items */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-violet-600" />
        </div>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500" />
            <p className="mt-2 font-medium">All caught up!</p>
            <p className="text-sm text-muted-foreground">No {statusFilter} content items to review.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const isExpanded = expandedId === item.id;
            const score = parseFloat(item.qualityScore ?? "0");

            return (
              <Card key={item.id} className="overflow-hidden">
                {/* Header row — always visible */}
                <div
                  className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-muted/30"
                  onClick={() => setExpandedId(isExpanded ? null : item.id)}
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-violet-600/10">
                    <FileText className="h-4 w-4 text-violet-600" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{item.title}</span>
                      <ContentTypeBadge type={item.contentType} />
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{item.boardCode}</span>
                      <span>Class {item.grade}</span>
                      <span>{item.subjectName}</span>
                      <span className="hidden sm:inline">· {item.topicTitle}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <QualityScoreBadge score={score} />
                    <SourceBadge source={item.sourceType} />
                    <LangBadge lang={item.language} />
                    {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                  </div>
                </div>

                {/* Expanded content */}
                {isExpanded && (
                  <>
                    <Separator />
                    <div className="px-4 py-3">
                      {/* Preview */}
                      <div className="mb-3 max-h-80 overflow-y-auto rounded-lg border bg-muted/30 p-4">
                        <div className="prose prose-sm max-w-none dark:prose-invert">
                          {/* Render first 3000 chars of body */}
                          <pre className="whitespace-pre-wrap text-xs leading-relaxed">
                            {item.body.slice(0, 3000)}
                            {item.body.length > 3000 && "\n\n... (truncated)"}
                          </pre>
                        </div>
                      </div>

                      {/* Metadata */}
                      <div className="mb-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                        {item.metadata?.aiModel ? <span>Model: {String(item.metadata.aiModel)}</span> : null}
                        {item.metadata?.aiCostUsd ? <span>Cost: ${Number(item.metadata.aiCostUsd).toFixed(4)}</span> : null}
                        {item.sourceUrl && (
                          <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-violet-600 hover:underline">
                            Source URL
                          </a>
                        )}
                        <span>Created: {new Date(item.createdAt).toLocaleDateString()}</span>
                      </div>

                      {/* Action buttons */}
                      {statusFilter === "pending" && (
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            className="bg-emerald-600 hover:bg-emerald-700"
                            disabled={actionLoading === item.id}
                            onClick={(e) => { e.stopPropagation(); handleAction(item.id, "approve"); }}
                          >
                            {actionLoading === item.id ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />}
                            Approve & Publish
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={actionLoading === item.id}
                            onClick={(e) => { e.stopPropagation(); handleAction(item.id, "reject"); }}
                          >
                            <XCircle className="mr-1.5 h-3.5 w-3.5" /> Reject
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={actionLoading === item.id}
                            onClick={(e) => { e.stopPropagation(); handleAction(item.id, "flag"); }}
                          >
                            <Flag className="mr-1.5 h-3.5 w-3.5" /> Flag for Review
                          </Button>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Badge components
// ---------------------------------------------------------------------------

function QualityScoreBadge({ score }: { score: number }) {
  let color = "bg-red-500/10 text-red-600";
  let icon = <AlertTriangle className="mr-0.5 h-3 w-3" />;
  if (score >= 0.7) {
    color = "bg-emerald-500/10 text-emerald-600";
    icon = <Star className="mr-0.5 h-3 w-3" />;
  } else if (score >= 0.5) {
    color = "bg-amber-500/10 text-amber-600";
    icon = <Star className="mr-0.5 h-3 w-3" />;
  }
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${color}`}>
      {icon}{(score * 100).toFixed(0)}%
    </span>
  );
}

function ContentTypeBadge({ type }: { type: string }) {
  const labels: Record<string, string> = {
    note: "Notes",
    flashcard_set: "Flashcards",
    explanation: "Explanation",
    lesson_plan: "Lesson Plan",
    practice_set: "Practice",
    video_link: "Video",
    interactive: "Interactive",
  };
  return <Badge variant="secondary" className="text-[10px]">{labels[type] ?? type}</Badge>;
}

function SourceBadge({ source }: { source: string }) {
  const colors: Record<string, string> = {
    ai_generated: "bg-violet-500/10 text-violet-600",
    ncert: "bg-blue-500/10 text-blue-600",
    diksha: "bg-emerald-500/10 text-emerald-600",
    kerala_scert: "bg-teal-500/10 text-teal-600",
  };
  return (
    <span className={`hidden rounded-full px-2 py-0.5 text-[10px] font-medium sm:inline ${colors[source] ?? "bg-gray-500/10 text-gray-600"}`}>
      {source.replace(/_/g, " ")}
    </span>
  );
}

function LangBadge({ lang }: { lang: string }) {
  const labels: Record<string, string> = { en: "EN", hi: "HI", ml: "ML", ta: "TA", te: "TE", kn: "KN", mr: "MR" };
  return <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium">{labels[lang] ?? lang.toUpperCase()}</span>;
}
