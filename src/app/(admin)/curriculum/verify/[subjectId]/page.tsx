"use client";

import { useEffect, useState, useCallback, Fragment } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  Flag,
  Cpu,
  ExternalLink,
  FileText,
  Layers,
  Search,
  Loader2,
} from "lucide-react";

interface TopicData {
  id: number;
  title: string;
  description: string | null;
  bloomLevel: string | null;
  estimatedMinutes: number | null;
  sortOrder: number;
}

interface ChapterData {
  id: number;
  chapterNumber: number;
  title: string;
  description: string | null;
  estimatedHours: string | null;
  weightagePct: string | null;
  topics: TopicData[];
}

interface SubjectInfo {
  id: number;
  name: string;
  code: string;
  maxMarks: number | null;
  grade: number;
  stream: string | null;
  boardCode: string;
  boardName: string;
  reviewStatus: string;
  aiModel: string | null;
  parsedAt: string | null;
  sourcePdf: string | null;
  sourceUrl: string | null;
  scrapeJobId: number | null;
}

interface VerifyData {
  subject: SubjectInfo;
  parsedContent: ChapterData[];
  rawText: string | null;
  hasRawText: boolean;
}

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-amber-500/15 text-amber-600",
  approved: "bg-green-500/15 text-green-600",
  rejected: "bg-red-500/15 text-red-600",
  flagged: "bg-orange-500/15 text-orange-600",
};

export default function VerifySubjectPage() {
  const params = useParams();
  const router = useRouter();
  const subjectId = params.subjectId as string;

  const [data, setData] = useState<VerifyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [reviewing, setReviewing] = useState(false);
  const [highlightTerm, setHighlightTerm] = useState("");

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/curriculum-explorer/${subjectId}/verify`);
      const json = await res.json();
      if (json.success) {
        setData(json.data);
      }
    } catch {
      console.error("Failed to load verify data");
    } finally {
      setLoading(false);
    }
  }, [subjectId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function handleReview(action: "approve" | "reject" | "flag") {
    setReviewing(true);
    try {
      const res = await fetch(`/api/admin/curriculum-explorer/${subjectId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const json = await res.json();
      if (json.success) {
        fetchData(); // Refresh
      }
    } catch {
      // Ignore
    } finally {
      setReviewing(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
        Loading verification data...
      </div>
    );
  }

  if (!data) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Subject not found or failed to load.
        </CardContent>
      </Card>
    );
  }

  const { subject, parsedContent, rawText } = data;
  const totalChapters = parsedContent.length;
  const totalTopics = parsedContent.reduce((s, c) => s + c.topics.length, 0);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => router.push("/curriculum")}>
            <ArrowLeft className="size-4" />
          </Button>
          <div>
            <h1 className="text-xl font-bold">
              Verify: {subject.name} ({subject.code})
            </h1>
            <p className="text-sm text-muted-foreground">
              {subject.boardCode} · Class {subject.grade}
              {subject.stream && ` · ${subject.stream}`}
              {" · "}{totalChapters} chapters · {totalTopics} topics
            </p>
          </div>
        </div>
        <Badge className={STATUS_COLORS[subject.reviewStatus] ?? STATUS_COLORS.pending}>
          {subject.reviewStatus}
        </Badge>
      </div>

      {/* Source info bar */}
      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground rounded-lg border bg-muted/30 p-3">
        {subject.aiModel && (
          <span className="flex items-center gap-1">
            <Cpu className="size-3" />
            Parsed by: {subject.aiModel}
          </span>
        )}
        {subject.parsedAt && (
          <span>Parsed: {new Date(subject.parsedAt).toLocaleDateString()}</span>
        )}
        {subject.sourceUrl && (
          <a
            href={subject.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-blue-500 hover:underline"
          >
            Original PDF <ExternalLink className="size-3" />
          </a>
        )}
        {subject.sourcePdf && (
          <span className="flex items-center gap-1">
            <FileText className="size-3" />
            Local: {subject.sourcePdf}
          </span>
        )}
        {subject.scrapeJobId && (
          <span>Job #{subject.scrapeJobId}</span>
        )}
      </div>

      {/* Review actions */}
      <div className="flex items-center gap-3">
        <Button
          size="sm"
          variant="outline"
          className="text-green-600 hover:text-green-700"
          onClick={() => handleReview("approve")}
          disabled={reviewing || subject.reviewStatus === "approved"}
        >
          <CheckCircle2 className="mr-1.5 size-3.5" />
          Approve
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="text-red-600 hover:text-red-700"
          onClick={() => handleReview("reject")}
          disabled={reviewing}
        >
          <XCircle className="mr-1.5 size-3.5" />
          Reject
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="text-orange-600 hover:text-orange-700"
          onClick={() => handleReview("flag")}
          disabled={reviewing}
        >
          <Flag className="mr-1.5 size-3.5" />
          Flag for Re-parse
        </Button>

        <div className="flex-1" />

        {/* Search / highlight */}
        <div className="relative w-[220px]">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Highlight in text..."
            value={highlightTerm}
            onChange={(e) => setHighlightTerm(e.target.value)}
            className="h-8 pl-8 text-xs"
          />
        </div>
      </div>

      {/* Side-by-side comparison */}
      <div className="grid gap-4 lg:grid-cols-2" style={{ height: "calc(100vh - 320px)" }}>
        {/* Left: Raw extracted text */}
        <Card className="flex flex-col">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              Raw Extracted Text
              {rawText && (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  ({rawText.length.toLocaleString()} chars)
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 overflow-hidden p-0">
            <ScrollArea className="h-full px-4 pb-4">
              {rawText ? (
                <pre className="whitespace-pre-wrap text-xs leading-relaxed font-mono">
                  <HighlightText text={rawText} query={highlightTerm} />
                </pre>
              ) : (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  <FileText className="mx-auto mb-2 size-8 opacity-30" />
                  <p>No raw text available.</p>
                  <p className="mt-1 text-xs">
                    Re-run the scraper to save PDF text locally.
                  </p>
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Right: Parsed content tree */}
        <Card className="flex flex-col">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              Parsed Content
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {totalChapters} chapters · {totalTopics} topics
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 overflow-hidden p-0">
            <ScrollArea className="h-full px-4 pb-4">
              {parsedContent.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No parsed content yet.
                </p>
              ) : (
                <div className="space-y-3">
                  {parsedContent.map((ch) => (
                    <div key={ch.id} className="rounded-lg border p-3">
                      <div className="flex items-center gap-2">
                        <Layers className="size-3.5 text-indigo-500" />
                        <span className="font-mono text-xs text-muted-foreground">
                          {ch.chapterNumber}.
                        </span>
                        <span
                          className="text-sm font-medium cursor-pointer hover:text-violet-600"
                          onClick={() => setHighlightTerm(ch.title)}
                          title="Click to highlight in raw text"
                        >
                          <HighlightText text={ch.title} query={highlightTerm} />
                        </span>
                        <span className="ml-auto flex gap-2 text-[10px] text-muted-foreground">
                          {ch.weightagePct && <span>{ch.weightagePct}%</span>}
                          {ch.estimatedHours && <span>{ch.estimatedHours}h</span>}
                        </span>
                      </div>
                      {ch.description && (
                        <p className="mt-1 text-xs text-muted-foreground">{ch.description}</p>
                      )}
                      {ch.topics.length > 0 && (
                        <div className="mt-2 space-y-0.5 ml-5">
                          {ch.topics.map((t) => (
                            <div
                              key={t.id}
                              className="flex items-center gap-1.5 text-xs cursor-pointer hover:text-violet-600"
                              onClick={() => setHighlightTerm(t.title)}
                              title="Click to highlight in raw text"
                            >
                              <FileText className="size-2.5 text-gray-400 shrink-0" />
                              <HighlightText text={t.title} query={highlightTerm} />
                              {t.bloomLevel && (
                                <Badge variant="outline" className="text-[8px] px-1 py-0 ml-auto shrink-0">
                                  {t.bloomLevel}
                                </Badge>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/** Highlight matching text in yellow */
function HighlightText({ text, query }: { text: string; query: string }) {
  if (!query || query.length < 2) return <>{text}</>;

  try {
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const parts = text.split(new RegExp(`(${escaped})`, "gi"));

    return (
      <>
        {parts.map((part, i) =>
          part.toLowerCase() === query.toLowerCase() ? (
            <mark key={i} className="rounded bg-yellow-200 px-0.5 dark:bg-yellow-800">
              {part}
            </mark>
          ) : (
            <Fragment key={i}>{part}</Fragment>
          )
        )}
      </>
    );
  } catch {
    return <>{text}</>;
  }
}
