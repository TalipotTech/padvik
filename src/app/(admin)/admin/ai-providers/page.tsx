"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  RefreshCw, Loader2, AlertTriangle, Zap, DollarSign, Clock,
  Activity, CheckCircle2, XCircle, Gauge,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AIUsageRow {
  ai_model_used: string;
  ai_provider: string | null;
  call_count: number;
  total_tokens: number;
  total_cost: number;
}

interface ProviderCard {
  name: string;
  provider: string;
  models: string[];
  status: "active" | "degraded" | "down";
  callCount: number;
  totalTokens: number;
  totalCost: number;
  rateLimit: number;
  color: string;
}

// ---------------------------------------------------------------------------
// Provider configurations
// ---------------------------------------------------------------------------

const PROVIDER_CONFIGS: Array<{
  name: string;
  provider: string;
  envKey: string;
  models: string[];
  rateLimit: number;
  color: string;
  description: string;
}> = [
  { name: "Anthropic Claude", provider: "anthropic", envKey: "ANTHROPIC_API_KEY", models: ["claude-sonnet-4", "claude-haiku-4.5"], rateLimit: 60, color: "violet", description: "Primary — quality notes, MCQs, syllabus parsing" },
  { name: "Google Gemini", provider: "gemini", envKey: "GOOGLE_GENERATIVE_AI_API_KEY", models: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite"], rateLimit: 60, color: "blue", description: "Multilingual — Indic OCR, Hindi/Tamil/Malayalam/Telugu parsing" },
  { name: "Mistral AI", provider: "mistral", envKey: "MISTRAL_API_KEY", models: ["mistral-large", "mistral-small"], rateLimit: 60, color: "orange", description: "Bulk — cost-effective alternative for scraping" },
  { name: "OpenAI GPT", provider: "openai", envKey: "OPENAI_API_KEY", models: ["gpt-4o", "gpt-4o-mini"], rateLimit: 60, color: "emerald", description: "Fallback — legacy support" },
  { name: "Perplexity", provider: "perplexity", envKey: "PERPLEXITY_API_KEY", models: ["sonar", "sonar-pro"], rateLimit: 30, color: "cyan", description: "Web search — current affairs, fact-checking" },
  { name: "Sarvam AI", provider: "sarvam", envKey: "SARVAM_API_KEY", models: ["(not yet integrated)"], rateLimit: 30, color: "pink", description: "Planned — Indic language OCR specialist" },
];

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AIProvidersPage() {
  const [usage, setUsage] = useState<AIUsageRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchUsage = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/pipeline-stats");
      const json = await res.json();
      if (json.success) {
        setUsage(json.data.aiUsageToday ?? []);
      }
    } catch (err) {
      console.error("Failed to fetch AI usage:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchUsage(); }, [fetchUsage]);

  // Build provider cards from config + usage data
  const providerCards: ProviderCard[] = PROVIDER_CONFIGS.map((config) => {
    const rows = usage.filter((u) =>
      (u.ai_provider ?? "").includes(config.provider) ||
      config.models.some((m) => u.ai_model_used.includes(m.split("-")[0]))
    );
    const callCount = rows.reduce((s, r) => s + r.call_count, 0);
    const totalTokens = rows.reduce((s, r) => s + r.total_tokens, 0);
    const totalCost = rows.reduce((s, r) => s + Number(r.total_cost), 0);

    return {
      name: config.name,
      provider: config.provider,
      models: config.models,
      status: callCount > 0 ? "active" : "active", // We can't know if down without probing
      callCount,
      totalTokens,
      totalCost,
      rateLimit: config.rateLimit,
      color: config.color,
    };
  });

  const totalCost = providerCards.reduce((s, p) => s + p.totalCost, 0);
  const totalCalls = providerCards.reduce((s, p) => s + p.callCount, 0);
  const totalTokens = providerCards.reduce((s, p) => s + p.totalTokens, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">AI Providers</h1>
          <p className="text-sm text-muted-foreground">Multi-provider status, usage, and cost tracking (last 24h)</p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchUsage}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Refresh
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-violet-600/10">
              <DollarSign className="h-5 w-5 text-violet-600" />
            </div>
            <div>
              <p className="text-2xl font-bold tabular-nums">${totalCost.toFixed(2)}</p>
              <p className="text-xs text-muted-foreground">Total cost today</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-600/10">
              <Zap className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-2xl font-bold tabular-nums">{totalCalls}</p>
              <p className="text-xs text-muted-foreground">API calls today</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-600/10">
              <Activity className="h-5 w-5 text-emerald-600" />
            </div>
            <div>
              <p className="text-2xl font-bold tabular-nums">{(totalTokens / 1000).toFixed(0)}k</p>
              <p className="text-xs text-muted-foreground">Tokens used today</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-violet-600" />
        </div>
      ) : (
        <>
          {/* Provider Cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {providerCards.map((provider) => (
              <ProviderStatusCard key={provider.provider} provider={provider} config={PROVIDER_CONFIGS.find((c) => c.provider === provider.provider)!} />
            ))}
          </div>

          {/* Usage breakdown table */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Model-Level Usage (24h)</CardTitle>
              <CardDescription>Detailed breakdown by AI model</CardDescription>
            </CardHeader>
            <CardContent>
              {usage.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">No AI calls in the last 24 hours</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs text-muted-foreground">
                        <th className="pb-2 pr-4 font-medium">Model</th>
                        <th className="pb-2 pr-4 font-medium">Provider</th>
                        <th className="pb-2 pr-4 text-right font-medium">Calls</th>
                        <th className="pb-2 pr-4 text-right font-medium">Tokens</th>
                        <th className="pb-2 text-right font-medium">Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {usage.map((row, i) => (
                        <tr key={i} className="border-b last:border-0">
                          <td className="py-2 pr-4">
                            <span className="font-mono text-xs">{row.ai_model_used}</span>
                          </td>
                          <td className="py-2 pr-4 text-xs text-muted-foreground">{row.ai_provider ?? "—"}</td>
                          <td className="py-2 pr-4 text-right tabular-nums">{row.call_count}</td>
                          <td className="py-2 pr-4 text-right tabular-nums">{(row.total_tokens / 1000).toFixed(1)}k</td>
                          <td className="py-2 text-right tabular-nums font-medium">${Number(row.total_cost).toFixed(4)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t font-medium">
                        <td className="pt-2 pr-4" colSpan={2}>Total</td>
                        <td className="pt-2 pr-4 text-right tabular-nums">{totalCalls}</td>
                        <td className="pt-2 pr-4 text-right tabular-nums">{(totalTokens / 1000).toFixed(1)}k</td>
                        <td className="pt-2 text-right tabular-nums">${totalCost.toFixed(4)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Routing Info */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Language-Based Routing</CardTitle>
              <CardDescription>How the provider auto-routes based on content language</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-2 sm:grid-cols-2">
                <RoutingRule lang="English (en)" provider="Anthropic Claude" route="Default — highest quality" />
                <RoutingRule lang="Hindi (hi)" provider="Google Gemini" route="Indic vision/OCR tasks" />
                <RoutingRule lang="Malayalam (ml)" provider="Google Gemini" route="Indic vision/OCR tasks" />
                <RoutingRule lang="Tamil (ta)" provider="Google Gemini" route="Indic vision/OCR tasks" />
                <RoutingRule lang="Telugu (te)" provider="Google Gemini" route="Indic vision/OCR tasks" />
                <RoutingRule lang="Kannada (kn)" provider="Google Gemini" route="Indic vision/OCR tasks" />
                <RoutingRule lang="Marathi (mr)" provider="Google Gemini" route="Indic vision/OCR tasks" />
              </div>
              <Separator className="my-3" />
              <div className="text-xs text-muted-foreground">
                <strong>Failover chains:</strong> English: Claude → OpenAI → Gemini | Indic: Gemini → Claude → OpenAI.
                Auto-failover on 429/500/timeout. Rate limits: 60 rpm per provider.
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ProviderStatusCard({
  provider,
  config,
}: {
  provider: ProviderCard;
  config: (typeof PROVIDER_CONFIGS)[number];
}) {
  const colorMap: Record<string, { bg: string; text: string; ring: string }> = {
    violet: { bg: "bg-violet-600/10", text: "text-violet-600", ring: "ring-violet-600/20" },
    blue: { bg: "bg-blue-600/10", text: "text-blue-600", ring: "ring-blue-600/20" },
    orange: { bg: "bg-orange-600/10", text: "text-orange-600", ring: "ring-orange-600/20" },
    emerald: { bg: "bg-emerald-600/10", text: "text-emerald-600", ring: "ring-emerald-600/20" },
    cyan: { bg: "bg-cyan-600/10", text: "text-cyan-600", ring: "ring-cyan-600/20" },
    pink: { bg: "bg-pink-600/10", text: "text-pink-600", ring: "ring-pink-600/20" },
  };
  const colors = colorMap[provider.color] ?? colorMap.violet;

  // Rate limit gauge (based on calls today / rough estimated capacity)
  const dailyCapacity = provider.rateLimit * 60 * 24; // theoretical max
  const usagePct = Math.min((provider.callCount / Math.max(dailyCapacity * 0.01, 1)) * 100, 100);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold">{provider.name}</CardTitle>
          <StatusIndicator active={provider.callCount > 0} />
        </div>
        <CardDescription className="text-xs">{config.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Stats */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <p className="text-lg font-bold tabular-nums">{provider.callCount}</p>
            <p className="text-[10px] text-muted-foreground">Calls</p>
          </div>
          <div>
            <p className="text-lg font-bold tabular-nums">{(provider.totalTokens / 1000).toFixed(0)}k</p>
            <p className="text-[10px] text-muted-foreground">Tokens</p>
          </div>
          <div>
            <p className="text-lg font-bold tabular-nums">${provider.totalCost.toFixed(2)}</p>
            <p className="text-[10px] text-muted-foreground">Cost</p>
          </div>
        </div>

        {/* Rate limit gauge */}
        <div>
          <div className="mb-1 flex items-center justify-between text-[10px] text-muted-foreground">
            <span>Rate Limit</span>
            <span>{provider.rateLimit} rpm</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full rounded-full transition-all ${
                usagePct > 80 ? "bg-red-500" : usagePct > 50 ? "bg-amber-500" : colors.text.replace("text-", "bg-")
              }`}
              style={{ width: `${Math.max(usagePct, 2)}%` }}
            />
          </div>
        </div>

        {/* Models */}
        <div className="flex flex-wrap gap-1">
          {provider.models.map((m) => (
            <span key={m} className={`rounded px-1.5 py-0.5 text-[9px] font-medium ${colors.bg} ${colors.text}`}>
              {m}
            </span>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function StatusIndicator({ active }: { active: boolean }) {
  return (
    <div className="flex items-center gap-1">
      <span className={`h-2 w-2 rounded-full ${active ? "bg-emerald-500" : "bg-gray-400"}`} />
      <span className="text-[10px] text-muted-foreground">{active ? "Active" : "Idle"}</span>
    </div>
  );
}

function RoutingRule({ lang, provider, route }: { lang: string; provider: string; route: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border px-3 py-2 text-xs">
      <Badge variant="secondary" className="text-[10px]">{lang}</Badge>
      <span className="text-muted-foreground">→</span>
      <span className="font-medium">{provider}</span>
      <span className="hidden text-muted-foreground sm:inline">({route})</span>
    </div>
  );
}
