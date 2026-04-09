"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Bell,
  Play,
  RefreshCw,
  Trash2,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Database,
  Zap,
  Globe,
} from "lucide-react";

interface BoardStat {
  boardId: number;
  boardCode: string;
  boardName: string;
  total: number;
  aiProcessed: number;
  breaking: number;
  latestDate: string | null;
  latestScrape: string | null;
}

interface Totals {
  total: number;
  aiProcessed: number;
  breaking: number;
}

interface RecentEntry {
  id: number;
  boardCode: string;
  title: string;
  category: string;
  aiProcessed: boolean;
  scrapedAt: string;
}

interface ScrapeResult {
  scraped: number;
  new: number;
  errors: string[];
}

const BOARD_COLORS: Record<string, string> = {
  CBSE: "bg-blue-600",
  ICSE: "bg-emerald-600",
  KL_SCERT: "bg-amber-600",
  KA_KSEAB: "bg-red-600",
  TN_DGE: "bg-indigo-600",
  MH_MSBSHSE: "bg-orange-600",
  AP_BSEAP: "bg-teal-600",
  TS_BSETS: "bg-pink-600",
};

export default function NotificationScraperPage() {
  const [stats, setStats] = useState<{
    totals: Totals;
    boards: BoardStat[];
    recent: RecentEntry[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [scraping, setScraping] = useState<string | null>(null); // null or boardCode or "all"
  const [lastResult, setLastResult] = useState<ScrapeResult | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/notifications");
      const data = await res.json();
      if (data?.success) setStats(data.data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  async function startScrape(boardCode?: string) {
    const key = boardCode ?? "all";
    setScraping(key);
    setLastResult(null);

    try {
      const res = await fetch("/api/admin/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(boardCode ? { boardCode } : {}),
      });
      const data = await res.json();
      if (data?.success) {
        setLastResult(data.data);
        // Refresh stats after scrape
        await fetchStats();
      } else {
        setLastResult({
          scraped: 0,
          new: 0,
          errors: [data?.error?.message ?? "Unknown error"],
        });
      }
    } catch (err) {
      setLastResult({
        scraped: 0,
        new: 0,
        errors: [err instanceof Error ? err.message : "Network error"],
      });
    } finally {
      setScraping(null);
    }
  }

  async function purgeBoard(boardCode: string) {
    if (!confirm(`Delete ALL notifications for ${boardCode}? This cannot be undone.`)) return;
    setDeleting(boardCode);
    try {
      const res = await fetch(`/api/admin/notifications?board=${boardCode}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (data?.success) {
        await fetchStats();
      }
    } catch {
      // ignore
    } finally {
      setDeleting(null);
    }
  }

  function formatDate(dateStr: string | null): string {
    if (!dateStr) return "Never";
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="size-8 animate-spin text-violet-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Bell className="size-6 text-violet-500" />
            Notification Scraper
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Scrape exam dates, results, circulars from official board websites
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchStats}
            disabled={!!scraping}
          >
            <RefreshCw className="mr-1.5 size-4" />
            Refresh
          </Button>
          <Button
            size="sm"
            onClick={() => startScrape()}
            disabled={!!scraping}
          >
            {scraping === "all" ? (
              <Loader2 className="mr-1.5 size-4 animate-spin" />
            ) : (
              <Play className="mr-1.5 size-4" />
            )}
            Scrape All Boards
          </Button>
        </div>
      </div>

      {/* Last result banner */}
      {lastResult && (
        <Card className={lastResult.errors.length > 0 ? "border-amber-300 bg-amber-50/50 dark:bg-amber-950/10" : "border-green-300 bg-green-50/50 dark:bg-green-950/10"}>
          <CardContent className="flex items-start gap-3 p-4">
            {lastResult.errors.length > 0 ? (
              <AlertCircle className="mt-0.5 size-5 shrink-0 text-amber-500" />
            ) : (
              <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-green-500" />
            )}
            <div className="flex-1">
              <p className="text-sm font-medium">
                Scrape complete: {lastResult.new} new / {lastResult.scraped} found
              </p>
              {lastResult.errors.length > 0 && (
                <div className="mt-2 space-y-1">
                  {lastResult.errors.map((e, i) => (
                    <p key={i} className="text-xs text-muted-foreground">
                      {e}
                    </p>
                  ))}
                </div>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLastResult(null)}
              className="shrink-0 text-xs"
            >
              Dismiss
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Overall stats */}
      {stats && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <div className="flex size-10 items-center justify-center rounded-lg bg-violet-100 dark:bg-violet-900/30">
                <Database className="size-5 text-violet-600" />
              </div>
              <div>
                <p className="text-2xl font-bold tabular-nums">{stats.totals.total}</p>
                <p className="text-xs text-muted-foreground">Total Notifications</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <div className="flex size-10 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900/30">
                <Zap className="size-5 text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-bold tabular-nums">{stats.totals.aiProcessed}</p>
                <p className="text-xs text-muted-foreground">AI Categorized</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <div className="flex size-10 items-center justify-center rounded-lg bg-red-100 dark:bg-red-900/30">
                <AlertCircle className="size-5 text-red-600" />
              </div>
              <div>
                <p className="text-2xl font-bold tabular-nums">{stats.totals.breaking}</p>
                <p className="text-xs text-muted-foreground">Breaking News</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Per-board cards */}
      {stats && (
        <div>
          <h2 className="mb-3 text-lg font-semibold">Boards</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {stats.boards.map((b) => {
              const bgColor = BOARD_COLORS[b.boardCode] ?? "bg-violet-600";
              const isScraping = scraping === b.boardCode;
              const isDeleting = deleting === b.boardCode;

              return (
                <Card key={b.boardId} className="overflow-hidden">
                  <CardHeader className="flex flex-row items-center gap-3 pb-3">
                    <div
                      className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${bgColor} text-xs font-bold text-white shadow-sm`}
                    >
                      {b.boardCode.slice(0, 2)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-sm">{b.boardCode}</CardTitle>
                      <p className="truncate text-xs text-muted-foreground">
                        {b.boardName}
                      </p>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3 pt-0">
                    {/* Stats row */}
                    <div className="flex items-center gap-3 text-xs">
                      <div className="flex items-center gap-1">
                        <Globe className="size-3 text-muted-foreground" />
                        <span className="font-medium tabular-nums">{b.total}</span>
                        <span className="text-muted-foreground">total</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Zap className="size-3 text-blue-500" />
                        <span className="font-medium tabular-nums">{b.aiProcessed}</span>
                        <span className="text-muted-foreground">AI</span>
                      </div>
                      {b.breaking > 0 && (
                        <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                          {b.breaking} breaking
                        </Badge>
                      )}
                    </div>

                    {/* Dates */}
                    <div className="space-y-1 text-xs text-muted-foreground">
                      <p>Latest: {b.latestDate ?? "—"}</p>
                      <p>Scraped: {formatDate(b.latestScrape)}</p>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 pt-1">
                      <Button
                        size="sm"
                        variant="default"
                        className="flex-1 text-xs"
                        onClick={() => startScrape(b.boardCode)}
                        disabled={!!scraping || !!deleting}
                      >
                        {isScraping ? (
                          <Loader2 className="mr-1 size-3 animate-spin" />
                        ) : (
                          <Play className="mr-1 size-3" />
                        )}
                        {isScraping ? "Scraping..." : "Scrape"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs text-red-500 hover:text-red-600"
                        onClick={() => purgeBoard(b.boardCode)}
                        disabled={!!scraping || !!deleting || b.total === 0}
                      >
                        {isDeleting ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          <Trash2 className="size-3" />
                        )}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* Recently scraped */}
      {stats && stats.recent.length > 0 && (
        <div>
          <h2 className="mb-3 text-lg font-semibold">Recently Scraped</h2>
          <Card>
            <CardContent className="p-0">
              <div className="divide-y">
                {stats.recent.map((r) => (
                  <div key={r.id} className="flex items-center gap-3 px-4 py-3">
                    <Badge variant="outline" className="shrink-0 text-[10px]">
                      {r.boardCode}
                    </Badge>
                    <p className="flex-1 truncate text-sm">{r.title}</p>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge
                        variant={r.aiProcessed ? "secondary" : "outline"}
                        className="text-[10px]"
                      >
                        {r.category}
                      </Badge>
                      {r.aiProcessed && (
                        <span title="AI processed"><Zap className="size-3 text-blue-500" /></span>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {formatDate(r.scrapedAt)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Info section */}
      <Card className="border-dashed">
        <CardContent className="p-4">
          <h3 className="text-sm font-medium">How it works</h3>
          <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
            <li>
              <strong>Scrape:</strong> Fetches notifications from official board websites (CBSE, ICSE, Kerala, Karnataka, etc.)
            </li>
            <li>
              <strong>Dedup:</strong> source_url is unique — same notification is never scraped twice
            </li>
            <li>
              <strong>AI Categorize:</strong> Uses Claude Haiku to classify into exam_date, result, admit_card, circular, etc.
            </li>
            <li>
              <strong>Auto cron:</strong> Runs every 3 hours via BullMQ when the worker is active
            </li>
            <li>
              <strong>CLI:</strong>{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">
                pnpm tsx scripts/scrape-notifications.ts [CBSE]
              </code>
            </li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
