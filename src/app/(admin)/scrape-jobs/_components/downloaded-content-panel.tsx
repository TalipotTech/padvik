"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FileText,
  BookOpen,
  Eye,
  ChevronDown,
  ChevronRight,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  X,
  ExternalLink,
  RefreshCw,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ContentItem {
  id: number;
  title: string;
  content_type: string;
  source_type: string;
  source_url: string | null;
  language: string;
  quality_score: string | null;
  review_status: string;
  is_published: boolean;
  body_length: number;
  created_at: string;
  topic_title: string;
  chapter_title: string;
  chapter_number: number;
  subject_name: string;
  grade: number;
  board_code: string;
  metadata: Record<string, unknown> | null;
}

interface SourceSummary {
  source_type: string;
  count: number;
  total_body_length: number;
  published: number;
  pending: number;
  avg_quality: number;
}

interface JobSummary {
  job_id: number;
  job_type: string;
  status: string;
  items_found: number;
  items_processed: number;
  content_count: number;
  total_body_length: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DownloadedContentPanel() {
  const [items, setItems] = useState<ContentItem[]>([]);
  const [summary, setSummary] = useState<SourceSummary[]>([]);
  const [byJob, setByJob] = useState<JobSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [sourceFilter, setSourceFilter] = useState("all");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [previewItem, setPreviewItem] = useState<ContentItem | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (sourceFilter !== "all") params.set("source", sourceFilter);
      const res = await fetch(`/api/admin/downloaded-content?${params}`);
      const json = await res.json();
      if (json.success) {
        setItems(json.data.items);
        setSummary(json.data.summary);
        setByJob(json.data.byJob);
      }
    } catch (err) {
      console.error("Failed to fetch:", err);
    } finally {
      setLoading(false);
    }
  }, [sourceFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-8 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading downloaded content...
      </div>
    );
  }

  const totalItems = summary.reduce((s, r) => s + r.count, 0);
  const totalPublished = summary.reduce((s, r) => s + r.published, 0);
  const totalPending = summary.reduce((s, r) => s + r.pending, 0);

  return (
    <div className="space-y-6">
      {/* Source summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard label="Total Content" value={totalItems} sub={`${totalPublished} published · ${totalPending} pending`} color="violet" />
        {summary.map((s) => (
          <SummaryCard
            key={s.source_type}
            label={formatSource(s.source_type)}
            value={s.count}
            sub={`${(s.total_body_length / 1024).toFixed(0)} KB · Quality: ${(s.avg_quality * 100).toFixed(0)}%`}
            color={s.source_type === "ncert" ? "blue" : s.source_type === "ai_generated" ? "violet" : "emerald"}
            onClick={() => setSourceFilter(s.source_type)}
            active={sourceFilter === s.source_type}
          />
        ))}
      </div>

      {/* Jobs that produced content */}
      {byJob.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Content Pipeline Jobs</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {byJob.map((j) => (
                <div key={j.job_id} className="flex items-center justify-between rounded-lg border px-3 py-2">
                  <div className="flex items-center gap-3">
                    <JobStatusDot status={j.status} />
                    <div>
                      <span className="text-sm font-medium">Job #{j.job_id}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{j.job_type.replace(/_/g, " ")}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-xs">
                    <span className="text-muted-foreground">{j.items_processed}/{j.items_found} processed</span>
                    <span className="font-medium text-violet-600">{j.content_count} content items</span>
                    <span className="text-muted-foreground">{(j.total_body_length / 1024).toFixed(0)} KB</span>
                    <span className="text-muted-foreground">{new Date(j.created_at).toLocaleDateString()}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filter bar */}
      <div className="flex items-center gap-3">
        <Select value={sourceFilter} onValueChange={setSourceFilter}>
          <SelectTrigger className="w-[160px] h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Sources</SelectItem>
            {summary.map((s) => (
              <SelectItem key={s.source_type} value={s.source_type}>
                {formatSource(s.source_type)} ({s.count})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">{items.length} items shown</span>
        <Button variant="ghost" size="sm" className="h-7 text-xs ml-auto" onClick={fetchData}>
          <RefreshCw className="mr-1 h-3 w-3" /> Refresh
        </Button>
      </div>

      {/* Content preview panel */}
      {previewItem && (
        <Card className="border-violet-200 dark:border-violet-800">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <div>
              <CardTitle className="text-sm">{previewItem.title}</CardTitle>
              <div className="text-xs text-muted-foreground mt-1">
                {previewItem.board_code} · Class {previewItem.grade} · {previewItem.subject_name} · Ch {previewItem.chapter_number}
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setPreviewItem(null)}><X className="h-4 w-4" /></Button>
          </CardHeader>
          <CardContent>
            <ContentPreview itemId={previewItem.id} />
          </CardContent>
        </Card>
      )}

      {/* Content items list */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Downloaded &amp; Processed Content</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {items.length === 0 ? (
            <div className="py-12 text-center">
              <FileText className="mx-auto h-10 w-10 text-muted-foreground/40" />
              <p className="mt-2 text-sm text-muted-foreground">
                No downloaded content yet. Run an NCERT Download, DIKSHA Ingest, or AI Content Generator job.
              </p>
            </div>
          ) : (
            <div className="divide-y">
              {items.map((item) => {
                const isExpanded = expandedId === item.id;
                const score = parseFloat(item.quality_score ?? "0");
                const meta = item.metadata ?? {};

                return (
                  <div key={item.id}>
                    {/* Row */}
                    <div
                      className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors"
                      onClick={() => setExpandedId(isExpanded ? null : item.id)}
                    >
                      {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}

                      {/* Parse status icon */}
                      <ParseStatusIcon bodyLength={item.body_length} reviewStatus={item.review_status} />

                      {/* Title + context */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium truncate">{item.title}</span>
                        </div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          {item.board_code} · Class {item.grade} · {item.subject_name} · Ch {item.chapter_number} — {item.topic_title}
                        </div>
                      </div>

                      {/* Badges */}
                      <div className="flex items-center gap-1.5 shrink-0">
                        <SourceBadge source={item.source_type} />
                        <LangBadge lang={item.language} />
                        <QualityBadge score={score} />
                        <StatusBadge status={item.review_status} published={item.is_published} />
                      </div>

                      {/* Body size */}
                      <span className="text-[10px] text-muted-foreground tabular-nums shrink-0 w-14 text-right">
                        {(item.body_length / 1024).toFixed(1)} KB
                      </span>
                    </div>

                    {/* Expanded detail */}
                    {isExpanded && (
                      <div className="border-t bg-muted/20 px-4 py-3 space-y-3">
                        {/* Metadata grid */}
                        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-4">
                          <MetaField label="Source Type" value={formatSource(item.source_type)} />
                          <MetaField label="Content Type" value={item.content_type} />
                          <MetaField label="Language" value={item.language.toUpperCase()} />
                          <MetaField label="Quality Score" value={`${(score * 100).toFixed(0)}%`} />
                          <MetaField label="Body Size" value={`${(item.body_length / 1024).toFixed(1)} KB`} />
                          <MetaField label="Review Status" value={item.review_status} />
                          <MetaField label="Published" value={item.is_published ? "Yes" : "No"} />
                          <MetaField label="Created" value={new Date(item.created_at).toLocaleString()} />
                          {meta.aiModel ? <MetaField label="AI Model" value={String(meta.aiModel)} /> : null}
                          {meta.aiCostUsd ? <MetaField label="AI Cost" value={`$${Number(meta.aiCostUsd).toFixed(4)}`} /> : null}
                          {meta.ncertBookCode ? <MetaField label="NCERT Book" value={String(meta.ncertBookCode)} /> : null}
                          {meta.ncertChapter ? <MetaField label="Chapter #" value={String(meta.ncertChapter)} /> : null}
                          {meta.extractedTextLength ? <MetaField label="Source Text" value={`${Number(meta.extractedTextLength).toLocaleString()} chars`} /> : null}
                          {meta.pdfPath ? <MetaField label="PDF Path" value={String(meta.pdfPath)} /> : null}
                        </div>

                        {/* Action buttons */}
                        <div className="flex gap-2">
                          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={(e) => { e.stopPropagation(); setPreviewItem(item); }}>
                            <Eye className="mr-1 h-3 w-3" /> Preview Content
                          </Button>
                          {item.source_url && (
                            <a href={item.source_url} target="_blank" rel="noopener noreferrer">
                              <Button variant="outline" size="sm" className="h-7 text-xs">
                                <ExternalLink className="mr-1 h-3 w-3" /> Source PDF
                              </Button>
                            </a>
                          )}
                          {meta.pdfPath ? (
                            <a href={`/api/admin/local-pdf?path=${encodeURIComponent(String(meta.pdfPath))}`} target="_blank" rel="noopener noreferrer">
                              <Button variant="outline" size="sm" className="h-7 text-xs">
                                <FileText className="mr-1 h-3 w-3" /> Local PDF
                              </Button>
                            </a>
                          ) : null}
                          <Link href={`/curriculum?subjectId=${String(meta.subjectId ?? "")}`}>
                            <Button variant="ghost" size="sm" className="h-7 text-xs">
                              <BookOpen className="mr-1 h-3 w-3" /> Syllabus
                            </Button>
                          </Link>
                        </div>

                        {/* Parse status detail */}
                        <div className="rounded-lg border bg-background p-3">
                          <div className="text-xs font-medium mb-2">Parse Status</div>
                          <div className="space-y-1.5">
                            <ParseStep ok={true} label="PDF Downloaded" detail={item.source_url ? `From: ${item.source_url.split("/").pop()}` : "Source available"} />
                            <ParseStep ok={item.body_length > 100} label="Text Extracted & AI Parsed" detail={item.body_length > 100 ? `Generated ${(item.body_length / 1024).toFixed(1)} KB of study notes` : "Body too short — may need manual review"} />
                            <ParseStep ok={item.body_length > 500} warn={item.body_length > 100 && item.body_length <= 500} label="Content Quality" detail={item.body_length > 500 ? `Full chapter content (${(item.body_length / 1024).toFixed(1)} KB)` : item.body_length > 100 ? "Partial content — may be incomplete" : "Very short — likely parsing issue"} />
                            <ParseStep ok={item.is_published} warn={!item.is_published && item.review_status === "pending"} label={item.is_published ? "Published & Live" : item.review_status === "approved" ? "Approved (publishing)" : "Awaiting Review"} detail={item.is_published ? "Visible to students" : "Go to Content Review to approve"} />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Content preview — fetches full body from API
// ---------------------------------------------------------------------------

function ContentPreview({ itemId }: { itemId: number }) {
  const [body, setBody] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/admin/content-preview?id=${itemId}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.success && json.data) {
          setBody(json.data.body);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [itemId]);

  if (loading) return <div className="py-4 text-sm text-muted-foreground"><Loader2 className="inline h-4 w-4 animate-spin mr-1" /> Loading content...</div>;
  if (!body) return <p className="py-4 text-sm text-muted-foreground">Content not found (id: {itemId}).</p>;

  return (
    <div className="max-h-[500px] overflow-y-auto rounded-lg bg-muted/30 p-4">
      <pre className="whitespace-pre-wrap text-xs leading-relaxed">{body}</pre>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SummaryCard({ label, value, sub, color, onClick, active }: {
  label: string; value: number; sub: string; color: string; onClick?: () => void; active?: boolean;
}) {
  return (
    <Card
      className={`${onClick ? "cursor-pointer hover:border-violet-300" : ""} ${active ? "border-violet-500 ring-1 ring-violet-500/20" : ""} transition-colors`}
      onClick={onClick}
    >
      <CardContent className="p-3">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`text-2xl font-bold ${color === "violet" ? "text-violet-600" : color === "blue" ? "text-blue-600" : "text-emerald-600"}`}>{value}</div>
        <div className="text-[10px] text-muted-foreground">{sub}</div>
      </CardContent>
    </Card>
  );
}

function ParseStatusIcon({ bodyLength, reviewStatus }: { bodyLength: number; reviewStatus: string }) {
  if (reviewStatus === "approved" || reviewStatus === "published") {
    return <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />;
  }
  if (bodyLength < 100) {
    return <AlertTriangle className="h-4 w-4 text-red-500 shrink-0" />;
  }
  if (bodyLength < 500) {
    return <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />;
  }
  return <CheckCircle2 className="h-4 w-4 text-blue-500 shrink-0" />;
}

function ParseStep({ ok, warn, label, detail }: { ok: boolean; warn?: boolean; label: string; detail: string }) {
  return (
    <div className="flex items-start gap-2">
      {ok ? (
        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 mt-0.5 shrink-0" />
      ) : warn ? (
        <AlertTriangle className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />
      ) : (
        <AlertTriangle className="h-3.5 w-3.5 text-gray-400 mt-0.5 shrink-0" />
      )}
      <div>
        <div className="text-[11px] font-medium">{label}</div>
        <div className="text-[10px] text-muted-foreground">{detail}</div>
      </div>
    </div>
  );
}

function SourceBadge({ source }: { source: string }) {
  const colors: Record<string, string> = {
    ncert: "bg-blue-500/10 text-blue-600",
    diksha: "bg-emerald-500/10 text-emerald-600",
    ai_generated: "bg-violet-500/10 text-violet-600",
    kerala_scert: "bg-teal-500/10 text-teal-600",
    karnataka_ktbs: "bg-orange-500/10 text-orange-600",
    tamilnadu_dge: "bg-rose-500/10 text-rose-600",
    maharashtra_balbharati: "bg-amber-500/10 text-amber-600",
  };
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${colors[source] ?? "bg-gray-500/10 text-gray-600"}`}>{formatSource(source)}</span>;
}

function LangBadge({ lang }: { lang: string }) {
  const labels: Record<string, string> = { en: "EN", hi: "HI", ml: "ML", ta: "TA", te: "TE", kn: "KN", mr: "MR" };
  return <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium">{labels[lang] ?? lang.toUpperCase()}</span>;
}

function QualityBadge({ score }: { score: number }) {
  const color = score >= 0.7 ? "text-emerald-600 bg-emerald-500/10" : score >= 0.5 ? "text-amber-600 bg-amber-500/10" : "text-red-600 bg-red-500/10";
  return <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${color}`}>{(score * 100).toFixed(0)}%</span>;
}

function StatusBadge({ status, published }: { status: string; published: boolean }) {
  if (published) return <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600">Published</span>;
  const colors: Record<string, string> = {
    pending: "bg-amber-500/10 text-amber-600",
    approved: "bg-blue-500/10 text-blue-600",
    rejected: "bg-red-500/10 text-red-600",
  };
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${colors[status] ?? "bg-gray-500/10 text-gray-600"}`}>{status}</span>;
}

function MetaField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="text-xs font-medium truncate">{value}</div>
    </div>
  );
}

function JobStatusDot({ status }: { status: string }) {
  const color = status === "completed" ? "bg-emerald-500" : status === "running" ? "bg-blue-500 animate-pulse" : status === "failed" ? "bg-red-500" : "bg-gray-400";
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} />;
}

function formatSource(source: string): string {
  const map: Record<string, string> = {
    ncert: "NCERT",
    diksha: "DIKSHA",
    ai_generated: "AI Generated",
    kerala_scert: "Kerala SCERT",
    karnataka_ktbs: "Karnataka",
    tamilnadu_dge: "Tamil Nadu",
    maharashtra_balbharati: "Maharashtra",
    scraped: "Scraped",
  };
  return map[source] ?? source.replace(/_/g, " ");
}
