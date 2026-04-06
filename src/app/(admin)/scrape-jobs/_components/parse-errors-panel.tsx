"use client";

import { useState, useEffect, useCallback } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  RotateCcw,
  FileText,
  Loader2,
  CheckCircle,
  TrendingUp,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface ParseErrorLog {
  id: number;
  stage: string;
  status: string;
  jobId: number;
  filename: string | null;
  url: string | null;
  model: string | null;
  error: string | null;
  recoveryError: string | null;
  rawResponsePreview: string | null;
  recoveredQuestions: number | null;
  droppedQuestions: number | null;
  totalRawQuestions: number | null;
  costUsd: number | null;
  tokens: number | null;
  processingTimeMs: number | null;
  createdAt: string;
  retryQuestionsInserted: number | null;
  retryModel: string | null;
  retryCostUsd: number | null;
  retriedAt: string | null;
  retryError: string | null;
}

interface ParseErrorStats {
  total: number;
  failed: number;
  recovered: number;
  retried: number;
  recoveryRate: number;
  wastedCostUsd: number;
}

interface TopError {
  pattern: string;
  count: number;
}

interface ParseErrorsResponse {
  logs: ParseErrorLog[];
  stats: ParseErrorStats;
  topErrors: TopError[];
}

export function ParseErrorsPanel({ jobTypeFilter = "all" }: { jobTypeFilter?: string }) {
  const [data, setData] = useState<ParseErrorsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [retrying, setRetrying] = useState<number | null>(null);
  const [retryResult, setRetryResult] = useState<Record<number, string>>({});
  const [retryingAll, setRetryingAll] = useState(false);
  const [retryAllResult, setRetryAllResult] = useState<string | null>(null);

  const fetchErrors = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (jobTypeFilter !== "all") params.set("jobType", jobTypeFilter);
      const res = await fetch(`/api/admin/parse-errors?${params}`);
      const body = await res.json();
      if (body.success) setData(body.data);
    } catch {
      // Handle silently
    } finally {
      setLoading(false);
    }
  }, [statusFilter, jobTypeFilter]);

  useEffect(() => {
    fetchErrors();
  }, [fetchErrors]);

  const handleRetry = async (logId: number) => {
    setRetrying(logId);
    setRetryResult((prev) => ({ ...prev, [logId]: "" }));
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 300000); // 5 min timeout
      const res = await fetch(`/api/admin/parse-errors/${logId}/retry`, {
        method: "POST",
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const body = await res.json();
      if (body.success) {
        setRetryResult((prev) => ({
          ...prev,
          [logId]: `Inserted ${body.data.questionsInserted} questions ($${body.data.costUsd.toFixed(4)})`,
        }));
        fetchErrors();
      } else {
        setRetryResult((prev) => ({
          ...prev,
          [logId]: `Failed: ${body.error?.message ?? "Unknown error"}`,
        }));
      }
    } catch (err) {
      setRetryResult((prev) => ({
        ...prev,
        [logId]: `Error: ${err instanceof Error ? err.message : "Network error"}`,
      }));
    } finally {
      setRetrying(null);
    }
  };

  const handleRetryAll = async () => {
    if (!confirm(`Retry all ${stats?.failed ?? 0} failed documents? This will re-download and re-parse each one.`)) return;
    setRetryingAll(true);
    setRetryAllResult(null);
    try {
      const res = await fetch("/api/admin/parse-errors/retry-all", { method: "POST" });
      const body = await res.json();
      if (body.success) {
        setRetryAllResult(
          `Done: ${body.data.succeeded} succeeded, ${body.data.failed} failed out of ${body.data.retried} retried`
        );
        fetchErrors();
      } else {
        setRetryAllResult(`Error: ${body.error?.message ?? "Unknown"}`);
      }
    } catch (err) {
      setRetryAllResult(`Error: ${err instanceof Error ? err.message : "Network error"}`);
    } finally {
      setRetryingAll(false);
    }
  };

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const stats = data?.stats;

  return (
    <div className="space-y-6">
      {/* Stats cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-red-500" />
              <span className="text-2xl font-bold">{stats?.failed ?? 0}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">Failed</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-yellow-500" />
              <span className="text-2xl font-bold">{stats?.recovered ?? 0}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">Recovered</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-500" />
              <span className="text-2xl font-bold">{stats?.retried ?? 0}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">Retried OK</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-green-500" />
              <span className="text-2xl font-bold">{stats?.recoveryRate ?? 0}%</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">Recovery Rate</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <span className="text-2xl font-bold">
              ${(stats?.wastedCostUsd ?? 0).toFixed(3)}
            </span>
            <p className="text-xs text-muted-foreground mt-1">Wasted Cost</p>
          </CardContent>
        </Card>
      </div>

      {/* Common error patterns */}
      {(data?.topErrors ?? []).length > 0 && (
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-sm font-medium mb-2">Common Error Patterns</p>
            <div className="space-y-1.5">
              {data?.topErrors.map((err, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <Badge variant="outline" className="shrink-0">
                    {err.count}x
                  </Badge>
                  <code className="text-muted-foreground truncate font-mono text-[11px]">
                    {err.pattern}
                  </code>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Issues</SelectItem>
            <SelectItem value="failed">Failed Only</SelectItem>
            <SelectItem value="recovered">Recovered Only</SelectItem>
            <SelectItem value="retried">Retried OK</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={fetchErrors}>
          <RefreshCw className="h-3 w-3 mr-1" /> Refresh
        </Button>
        {(stats?.failed ?? 0) > 0 && (
          <Button
            variant="default"
            size="sm"
            onClick={handleRetryAll}
            disabled={retryingAll}
          >
            {retryingAll ? (
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            ) : (
              <RotateCcw className="h-3 w-3 mr-1" />
            )}
            Retry All Failed ({stats?.failed})
          </Button>
        )}
        {retryAllResult && (
          <span className={`text-xs ${retryAllResult.startsWith("Done") ? "text-green-700" : "text-red-700"}`}>
            {retryAllResult}
          </span>
        )}
        <span className="text-xs text-muted-foreground ml-auto">
          {data?.logs.length ?? 0} entries
        </span>
      </div>

      {/* Error list */}
      {(data?.logs ?? []).length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <CheckCircle className="h-10 w-10 mx-auto mb-3 text-green-500 opacity-50" />
            <p>No parse errors found.</p>
            <p className="text-xs mt-1">All documents parsed successfully.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {data?.logs.map((log) => {
            const isExpanded = expandedId === log.id;
            const isFailed = log.status === "failed";
            const isRetried = log.status === "retried_success";

            return (
              <Card
                key={log.id}
                className={
                  isFailed
                    ? "border-red-200 bg-red-50/30"
                    : isRetried
                      ? "border-green-200 bg-green-50/30"
                      : "border-yellow-200 bg-yellow-50/30"
                }
              >
                <CardContent className="pt-3 pb-2">
                  {/* Header row */}
                  <div
                    className="flex items-center gap-3 cursor-pointer"
                    onClick={() => setExpandedId(isExpanded ? null : log.id)}
                  >
                    {isFailed ? (
                      <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
                    ) : isRetried ? (
                      <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />
                    ) : (
                      <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0" />
                    )}

                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        <FileText className="h-3 w-3 inline mr-1" />
                        {log.filename ?? "Unknown document"}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Badge
                          variant="outline"
                          className={`text-[10px] ${
                            isFailed
                              ? "text-red-700 border-red-300"
                              : isRetried
                                ? "text-green-700 border-green-300"
                                : "text-yellow-700 border-yellow-300"
                          }`}
                        >
                          {isFailed ? "Failed" : isRetried ? "Retried OK" : "Recovered"}
                        </Badge>
                        {log.model && (
                          <span className="text-[10px] text-muted-foreground">
                            {log.model}
                          </span>
                        )}
                        <span className="text-[10px] text-muted-foreground">
                          Job #{log.jobId}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {log.recoveredQuestions !== null && (
                        <span className="text-xs text-muted-foreground">
                          {log.recoveredQuestions}Q recovered
                        </span>
                      )}
                      <span className="text-[10px] text-muted-foreground">
                        {new Date(log.createdAt).toLocaleString()}
                      </span>
                      {isExpanded ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                    </div>
                  </div>

                  {/* Expanded details */}
                  {isExpanded && (
                    <div className="mt-3 pt-3 border-t space-y-3 text-xs">
                      {/* Retry success info */}
                      {isRetried && log.retryQuestionsInserted !== null && (
                        <div className="bg-green-50 border border-green-200 rounded p-2">
                          <p className="font-medium text-green-800 mb-1">
                            Retry Successful
                          </p>
                          <p className="text-green-700">
                            Inserted <strong>{log.retryQuestionsInserted}</strong> questions
                            using {log.retryModel ?? "AI"}
                            {log.retryCostUsd ? ` ($${Number(log.retryCostUsd).toFixed(4)})` : ""}
                            {log.retriedAt ? ` at ${new Date(log.retriedAt).toLocaleString()}` : ""}
                          </p>
                        </div>
                      )}

                      {/* Retry error (if retry was attempted but failed) */}
                      {log.retryError && (
                        <div className="bg-orange-50 border border-orange-200 rounded p-2">
                          <p className="font-medium text-orange-800 mb-1">Last Retry Failed</p>
                          <pre className="text-[11px] whitespace-pre-wrap font-mono text-orange-700">{log.retryError}</pre>
                        </div>
                      )}

                      {/* Original error (shown as context for all statuses) */}
                      {log.error && (
                        <div>
                          <p className="font-medium text-red-700 mb-1">
                            {isRetried ? "Original Validation Error (resolved)" : "Validation Error"}
                          </p>
                          <pre className={`${isRetried ? "bg-muted/30 border-muted" : "bg-red-50 border-red-200"} border rounded p-2 overflow-x-auto text-[11px] whitespace-pre-wrap font-mono`}>
                            {log.error}
                          </pre>
                        </div>
                      )}

                      {/* Recovery error (if recovery also failed) */}
                      {log.recoveryError && (
                        <div>
                          <p className="font-medium text-red-700 mb-1">
                            Recovery Error
                          </p>
                          <pre className="bg-red-50 border border-red-200 rounded p-2 overflow-x-auto text-[11px] whitespace-pre-wrap font-mono">
                            {log.recoveryError}
                          </pre>
                        </div>
                      )}

                      {/* Raw AI response preview */}
                      {log.rawResponsePreview && !isRetried && (
                        <div>
                          <p className="font-medium text-muted-foreground mb-1">
                            Raw AI Response (first 1000 chars)
                          </p>
                          <pre className="bg-muted/50 border rounded p-2 overflow-x-auto text-[11px] whitespace-pre-wrap font-mono max-h-48 overflow-y-auto">
                            {log.rawResponsePreview}
                          </pre>
                        </div>
                      )}

                      {/* Recovery stats */}
                      {log.recoveredQuestions !== null && (
                        <div className="flex gap-4 text-muted-foreground">
                          <span>
                            Raw questions: <strong>{log.totalRawQuestions}</strong>
                          </span>
                          <span>
                            Recovered: <strong className="text-green-700">{log.recoveredQuestions}</strong>
                          </span>
                          <span>
                            Dropped: <strong className="text-red-700">{log.droppedQuestions}</strong>
                          </span>
                        </div>
                      )}

                      {/* Source URL */}
                      {log.url && (
                        <div>
                          <span className="text-muted-foreground">Source: </span>
                          <a
                            href={log.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-violet-600 hover:underline break-all"
                          >
                            {log.url}
                          </a>
                        </div>
                      )}

                      {/* Cost + tokens */}
                      <div className="flex gap-4 text-muted-foreground">
                        {log.tokens && <span>Tokens: {log.tokens.toLocaleString()}</span>}
                        {log.costUsd && <span>Cost: ${Number(log.costUsd).toFixed(4)}</span>}
                        {log.processingTimeMs && (
                          <span>Time: {(log.processingTimeMs / 1000).toFixed(1)}s</span>
                        )}
                      </div>

                      {/* Retry button — always available if URL exists */}
                      {log.url && (
                        <div className="flex items-center gap-2 pt-1">
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-xs"
                            disabled={retrying === log.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRetry(log.id);
                            }}
                          >
                            {retrying === log.id ? (
                              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                            ) : (
                              <RotateCcw className="h-3 w-3 mr-1" />
                            )}
                            Re-parse with latest fixes
                          </Button>
                          {retryResult[log.id] && (
                            <span
                              className={`text-xs ${
                                retryResult[log.id].startsWith("Inserted")
                                  ? "text-green-700"
                                  : "text-red-700"
                              }`}
                            >
                              {retryResult[log.id]}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
