"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  FileText, HelpCircle, Database, BarChart3, RefreshCw, Clock,
  CheckCircle2, XCircle, AlertTriangle, Loader2, ArrowRight,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PipelineStats {
  totals: { contentItems: number; publishedItems: number; questions: number };
  contentBySource: Array<{ source_type: string; count: number; published: number }>;
  questionsBySource: Array<{ source_type: string; difficulty: string; count: number }>;
  coverageMatrix: Array<{ board_code: string; board_name: string; grade: number; topic_count: number; content_count: number; question_count: number }>;
  recentLogs: Array<{ id: number; pipeline_stage: string; entity_type: string; status: string; ai_model_used: string | null; ai_provider: string | null; processing_time_ms: number | null; created_at: string }>;
  activeJobs: Array<{ id: number; job_type: string; status: string; items_found: number; items_processed: number; created_at: string; metadata: Record<string, unknown> }>;
  aiUsageToday: Array<{ ai_model_used: string; ai_provider: string | null; call_count: number; total_tokens: number; total_cost: number }>;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function PipelineOverviewPage() {
  const [stats, setStats] = useState<PipelineStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/pipeline-stats");
      const json = await res.json();
      if (json.success) setStats(json.data);
      else setError(json.error?.message ?? "Failed to fetch");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-violet-600" />
      </div>
    );
  }

  if (error || !stats) {
    return (
      <div className="py-10 text-center">
        <AlertTriangle className="mx-auto h-10 w-10 text-amber-500" />
        <p className="mt-2 text-sm text-muted-foreground">{error ?? "No data"}</p>
        <Button variant="outline" size="sm" className="mt-4" onClick={fetchStats}>Retry</Button>
      </div>
    );
  }

  // Group coverage by board
  const boardCoverage = new Map<string, Array<{ grade: number; topic_count: number; content_count: number; question_count: number }>>();
  for (const row of stats.coverageMatrix) {
    const list = boardCoverage.get(row.board_code) ?? [];
    list.push(row);
    boardCoverage.set(row.board_code, list);
  }

  const todayTotalCost = stats.aiUsageToday.reduce((s, r) => s + Number(r.total_cost), 0);
  const todayTotalTokens = stats.aiUsageToday.reduce((s, r) => s + r.total_tokens, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Pipeline Overview</h1>
          <p className="text-sm text-muted-foreground">Content acquisition and processing status</p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchStats}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Refresh
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={<FileText className="h-5 w-5 text-violet-600" />} label="Content Items" value={stats.totals.contentItems} sub={`${stats.totals.publishedItems} published`} />
        <StatCard icon={<HelpCircle className="h-5 w-5 text-blue-600" />} label="Questions" value={stats.totals.questions} sub="all types" />
        <StatCard icon={<Database className="h-5 w-5 text-emerald-600" />} label="AI Cost Today" value={`$${todayTotalCost.toFixed(2)}`} sub={`${(todayTotalTokens / 1000).toFixed(0)}k tokens`} />
        <StatCard icon={<BarChart3 className="h-5 w-5 text-amber-600" />} label="Boards Covered" value={boardCoverage.size} sub={`${stats.coverageMatrix.length} board-grade pairs`} />
      </div>

      {/* Source Breakdown */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Content by Source</CardTitle>
          <CardDescription>Breakdown of content items by ingestion source</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {stats.contentBySource.map((src) => (
              <div key={src.source_type} className="flex items-center justify-between rounded-lg border px-3 py-2">
                <div>
                  <span className="text-sm font-medium">{formatSourceType(src.source_type)}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{src.published} published</span>
                </div>
                <Badge variant="secondary" className="tabular-nums">{src.count}</Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Coverage Matrix */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Coverage Matrix</CardTitle>
          <CardDescription>Topics, content, and questions per board and grade</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="pb-2 pr-4 font-medium">Board</th>
                  <th className="pb-2 pr-4 font-medium">Grade</th>
                  <th className="pb-2 pr-4 text-right font-medium">Topics</th>
                  <th className="pb-2 pr-4 text-right font-medium">Content</th>
                  <th className="pb-2 text-right font-medium">Questions</th>
                </tr>
              </thead>
              <tbody>
                {stats.coverageMatrix.slice(0, 30).map((row) => (
                  <tr key={`${row.board_code}-${row.grade}`} className="border-b last:border-0">
                    <td className="py-1.5 pr-4 font-medium">{row.board_code}</td>
                    <td className="py-1.5 pr-4">Class {row.grade}</td>
                    <td className="py-1.5 pr-4 text-right tabular-nums">{row.topic_count}</td>
                    <td className="py-1.5 pr-4 text-right tabular-nums">
                      <span className={row.content_count === 0 ? "text-red-500" : row.content_count < row.topic_count ? "text-amber-500" : "text-emerald-600"}>
                        {row.content_count}
                      </span>
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{row.question_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Active Jobs */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Recent Jobs</CardTitle>
              <Link href="/scrape-jobs">
                <Button variant="ghost" size="sm" className="text-xs">View All <ArrowRight className="ml-1 h-3 w-3" /></Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {stats.activeJobs.slice(0, 8).map((job) => (
                <div key={job.id} className="flex items-center justify-between rounded-lg border px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <StatusDot status={job.status} />
                      <span className="truncate text-sm font-medium">{job.job_type}</span>
                      <span className="text-xs text-muted-foreground">#{job.id}</span>
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {job.items_processed}/{job.items_found} items
                    </div>
                  </div>
                  <JobStatusBadge status={job.status} />
                </div>
              ))}
              {stats.activeJobs.length === 0 && (
                <p className="py-4 text-center text-sm text-muted-foreground">No recent jobs</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Recent Pipeline Logs */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Recent Pipeline Logs</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1.5">
              {stats.recentLogs.slice(0, 8).map((log) => (
                <div key={log.id} className="flex items-center justify-between rounded px-2 py-1.5 text-xs hover:bg-muted/50">
                  <div className="flex items-center gap-2">
                    {log.status === "completed" ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : <XCircle className="h-3.5 w-3.5 text-red-500" />}
                    <span className="font-medium">{log.pipeline_stage}</span>
                    {log.ai_model_used && (
                      <span className="rounded bg-violet-600/10 px-1.5 py-0.5 text-[10px] text-violet-600">{log.ai_model_used.split("-").slice(0, 2).join("-")}</span>
                    )}
                  </div>
                  <span className="text-muted-foreground">
                    {log.processing_time_ms ? `${(log.processing_time_ms / 1000).toFixed(1)}s` : ""}
                  </span>
                </div>
              ))}
              {stats.recentLogs.length === 0 && (
                <p className="py-4 text-center text-sm text-muted-foreground">No recent logs</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Quick Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            <Link href="/scrape-jobs"><Button variant="outline" size="sm">Manage Scrapers</Button></Link>
            <Link href="/admin/content-review"><Button variant="outline" size="sm">Review Content</Button></Link>
            <Link href="/admin/ai-providers"><Button variant="outline" size="sm">AI Provider Status</Button></Link>
            <Link href="/curriculum"><Button variant="outline" size="sm">Curriculum Explorer</Button></Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string | number; sub: string }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
          {icon}
        </div>
        <div>
          <p className="text-2xl font-bold tabular-nums">{value}</p>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-[10px] text-muted-foreground/70">{sub}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function StatusDot({ status }: { status: string }) {
  const color = status === "completed" ? "bg-emerald-500" : status === "running" ? "bg-blue-500 animate-pulse" : status === "failed" ? "bg-red-500" : "bg-gray-400";
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} />;
}

function JobStatusBadge({ status }: { status: string }) {
  const variants: Record<string, string> = {
    completed: "bg-emerald-500/10 text-emerald-600",
    running: "bg-blue-500/10 text-blue-600",
    failed: "bg-red-500/10 text-red-600",
    queued: "bg-amber-500/10 text-amber-600",
  };
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${variants[status] ?? "bg-gray-500/10 text-gray-600"}`}>{status}</span>;
}

function formatSourceType(source: string): string {
  const map: Record<string, string> = {
    ai_generated: "AI Generated",
    ncert: "NCERT",
    diksha: "DIKSHA",
    kerala_scert: "Kerala SCERT",
    karnataka_ktbs: "Karnataka KTBS",
    tamilnadu_dge: "Tamil Nadu DGE",
    maharashtra_balbharati: "Maharashtra",
    scraped: "Web Scraped",
  };
  return map[source] ?? source.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
}
