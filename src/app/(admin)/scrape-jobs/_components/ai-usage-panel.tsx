"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Cpu,
  Coins,
  Clock,
  Hash,
  Activity,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface ModelUsage {
  model: string | null;
  callCount: number;
  totalTokens: number;
  avgTokens: number;
  totalProcessingMs: number;
}

interface StageUsage {
  stage: string;
  callCount: number;
  totalTokens: number;
  successCount: number;
  failureCount: number;
}

interface ActivityEntry {
  id: number;
  pipelineStage: string;
  entityType: string;
  entityId: number;
  status: string;
  aiModelUsed: string | null;
  aiTokensUsed: number | null;
  processingTimeMs: number | null;
  errorMessage: string | null;
  outputData: Record<string, unknown> | null;
  createdAt: string;
}

interface AIUsageData {
  totals: { calls: number; tokens: number; processingMs: number };
  byModel: ModelUsage[];
  byStage: StageUsage[];
  recentActivity: ActivityEntry[];
  since: string;
}

// Cost per 1M tokens (mirrors provider.ts)
const COST_PER_1M: Record<string, { input: number; output: number }> = {
  "claude-sonnet-4-20250514": { input: 3.0, output: 15.0 },
  "claude-haiku-4-5-20251001": { input: 0.8, output: 4.0 },
  "gemini-2.0-flash": { input: 0.1, output: 0.4 },
  "gemini-2.0-flash-lite": { input: 0.075, output: 0.3 },
  "mistral-large-latest": { input: 2.0, output: 6.0 },
  "mistral-small-latest": { input: 0.1, output: 0.3 },
  "gpt-4o": { input: 2.5, output: 10.0 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
};

function estimateCost(model: string, tokens: number): number {
  const pricing = COST_PER_1M[model];
  if (!pricing) return 0;
  // Rough split: assume 40% input, 60% output
  const inputTokens = tokens * 0.4;
  const outputTokens = tokens * 0.6;
  return (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;
}

function getProviderName(model: string): string {
  if (model.startsWith("claude-")) return "Anthropic";
  if (model.startsWith("gemini-")) return "Google";
  if (model.startsWith("mistral-")) return "Mistral";
  if (model.startsWith("gpt-")) return "OpenAI";
  if (model.startsWith("sonar")) return "Perplexity";
  return "Unknown";
}

function getProviderColor(model: string): string {
  if (model.startsWith("claude-")) return "text-orange-600";
  if (model.startsWith("gemini-")) return "text-blue-600";
  if (model.startsWith("mistral-")) return "text-violet-600";
  if (model.startsWith("gpt-")) return "text-green-600";
  return "text-muted-foreground";
}

export function AIUsagePanel({ jobTypeFilter = "all" }: { jobTypeFilter?: string }) {
  const [data, setData] = useState<AIUsageData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchUsage = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (jobTypeFilter !== "all") params.set("jobType", jobTypeFilter);
      const res = await fetch(`/api/admin/ai-usage?${params}`);
      const json = await res.json();
      if (json.success) {
        setData(json.data);
      }
    } catch {
      // Silently ignore
    } finally {
      setLoading(false);
    }
  }, [jobTypeFilter]);

  useEffect(() => {
    fetchUsage();
    const interval = setInterval(fetchUsage, 10000);
    return () => clearInterval(interval);
  }, [fetchUsage]);

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading AI usage data...</p>;
  }

  if (!data) {
    return <p className="text-sm text-muted-foreground">No AI usage data available.</p>;
  }

  const totalCost = data.byModel.reduce(
    (sum, m) => sum + (m.model ? estimateCost(m.model, m.totalTokens) : 0),
    0
  );

  return (
    <div className="space-y-6">
      {/* Summary stats */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-start gap-2">
              <Hash className="mt-0.5 size-4 text-muted-foreground" />
              <div>
                <div className="text-xs text-muted-foreground">Total Calls</div>
                <div className="text-lg font-bold">{data.totals.calls}</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-start gap-2">
              <Activity className="mt-0.5 size-4 text-muted-foreground" />
              <div>
                <div className="text-xs text-muted-foreground">Total Tokens</div>
                <div className="text-lg font-bold">
                  {data.totals.tokens > 1_000_000
                    ? `${(data.totals.tokens / 1_000_000).toFixed(1)}M`
                    : data.totals.tokens > 1000
                      ? `${(data.totals.tokens / 1000).toFixed(1)}K`
                      : data.totals.tokens}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-start gap-2">
              <Coins className="mt-0.5 size-4 text-muted-foreground" />
              <div>
                <div className="text-xs text-muted-foreground">Est. Cost</div>
                <div className="text-lg font-bold">${totalCost.toFixed(4)}</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-start gap-2">
              <Clock className="mt-0.5 size-4 text-muted-foreground" />
              <div>
                <div className="text-xs text-muted-foreground">Avg Duration</div>
                <div className="text-lg font-bold">
                  {data.totals.calls > 0
                    ? `${(data.totals.processingMs / data.totals.calls / 1000).toFixed(1)}s`
                    : "—"}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Per-model breakdown */}
      {data.byModel.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Cpu className="size-4" />
              Provider Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {data.byModel.map((m) => {
                if (!m.model) return null;
                const cost = estimateCost(m.model, m.totalTokens);
                return (
                  <div
                    key={m.model}
                    className="flex items-center justify-between rounded-lg border bg-muted/30 p-3"
                  >
                    <div>
                      <div className={`text-sm font-medium ${getProviderColor(m.model)}`}>
                        {getProviderName(m.model)}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        <code>{m.model}</code>
                      </div>
                    </div>
                    <div className="flex gap-6 text-right text-sm">
                      <div>
                        <div className="text-muted-foreground text-xs">Calls</div>
                        <div className="font-medium">{m.callCount}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground text-xs">Tokens</div>
                        <div className="font-medium">
                          {m.totalTokens > 1000
                            ? `${(m.totalTokens / 1000).toFixed(1)}K`
                            : m.totalTokens}
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground text-xs">Cost</div>
                        <div className="font-medium">${cost.toFixed(4)}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Per-stage breakdown */}
      {data.byStage.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pipeline Stages</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {data.byStage.map((s) => (
                <div key={s.stage} className="rounded-lg border p-3">
                  <div className="text-sm font-medium capitalize">{s.stage.replace(/_/g, " ")}</div>
                  <div className="mt-1 flex gap-4 text-xs">
                    <span className="text-muted-foreground">{s.callCount} calls</span>
                    <span className="flex items-center gap-1 text-green-600">
                      <CheckCircle2 className="size-3" />
                      {s.successCount}
                    </span>
                    {s.failureCount > 0 && (
                      <span className="flex items-center gap-1 text-red-600">
                        <AlertCircle className="size-3" />
                        {s.failureCount}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent activity log */}
      {data.recentActivity.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-[300px] overflow-y-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2 pr-3">Stage</th>
                    <th className="pb-2 pr-3">Model</th>
                    <th className="pb-2 pr-3">Tokens</th>
                    <th className="pb-2 pr-3">Status</th>
                    <th className="pb-2">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentActivity.map((entry) => (
                    <tr key={entry.id} className="border-b last:border-0">
                      <td className="py-2 pr-3 capitalize">
                        {entry.pipelineStage.replace(/_/g, " ")}
                      </td>
                      <td className="py-2 pr-3">
                        {entry.aiModelUsed ? (
                          <span className={getProviderColor(entry.aiModelUsed)}>
                            {getProviderName(entry.aiModelUsed)}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="py-2 pr-3 font-mono">
                        {entry.aiTokensUsed ?? "—"}
                      </td>
                      <td className="py-2 pr-3">
                        <span
                          className={
                            entry.status === "completed"
                              ? "text-green-600"
                              : entry.status === "failed"
                                ? "text-red-600"
                                : "text-muted-foreground"
                          }
                        >
                          {entry.status}
                        </span>
                      </td>
                      <td className="py-2 text-muted-foreground">
                        {new Date(entry.createdAt).toLocaleTimeString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
