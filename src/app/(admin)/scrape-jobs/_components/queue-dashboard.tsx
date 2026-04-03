"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Pause, Play, Loader2 } from "lucide-react";

interface QueueCounts {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}

interface QueueStatus {
  scrape: QueueCounts;
  content: QueueCounts;
  file: QueueCounts;
}

const QUEUE_CONFIGS = [
  { key: "scrape" as const, label: "Scrape Queue", description: "PDF download and AI parsing jobs" },
  { key: "content" as const, label: "Content Queue", description: "Quality scoring and AI tagging" },
  { key: "file" as const, label: "File Queue", description: "File upload processing" },
];

function StatusDot({ count, color }: { count: number; color: string }) {
  return (
    <span className={`inline-block size-2 rounded-full ${count > 0 ? color : "bg-muted"}`} />
  );
}

export function QueueDashboard() {
  const [status, setStatus] = useState<QueueStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pausing, setPausing] = useState(false);
  const [isPaused, setIsPaused] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/queue-status");
      const json = await res.json();
      if (json.success && json.data) {
        setStatus(json.data);
        setError(null);
      } else if (json.error) {
        setError(json.error.message);
      }
    } catch {
      setError("Failed to connect to queue");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  async function togglePause() {
    setPausing(true);
    try {
      // Use a dummy job ID — the control endpoint pauses the whole queue
      const action = isPaused ? "resume" : "pause";
      await fetch("/api/admin/scrape-jobs/0/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      setIsPaused(!isPaused);
      fetchStatus();
    } catch {
      // Ignore
    } finally {
      setPausing(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Connecting to queues...
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="pt-4">
          <p className="text-sm text-muted-foreground">
            Queue status unavailable: {error}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Make sure Redis is running and workers are started with <code>pnpm workers</code>
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!status) return null;

  const totalActive = status.scrape.active + status.content.active + status.file.active;
  const totalWaiting = status.scrape.waiting + status.content.waiting + status.file.waiting;
  const totalFailed = status.scrape.failed + status.content.failed + status.file.failed;

  return (
    <div className="space-y-6">
      {/* Global controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <StatusDot count={totalActive} color="bg-blue-500" />
            <span className="text-sm">
              {totalActive > 0
                ? `${totalActive} active job${totalActive !== 1 ? "s" : ""}`
                : "No active jobs"}
            </span>
          </div>
          {totalWaiting > 0 && (
            <span className="text-sm text-amber-600">
              {totalWaiting} waiting
            </span>
          )}
          {totalFailed > 0 && (
            <span className="text-sm text-red-600">
              {totalFailed} failed
            </span>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={togglePause}
          disabled={pausing}
        >
          {pausing ? (
            <Loader2 className="mr-2 size-4 animate-spin" />
          ) : isPaused ? (
            <Play className="mr-2 size-4" />
          ) : (
            <Pause className="mr-2 size-4" />
          )}
          {isPaused ? "Resume All" : "Pause All"}
        </Button>
      </div>

      {/* Per-queue cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {QUEUE_CONFIGS.map(({ key, label, description }) => {
          const counts = status[key];
          return (
            <Card key={key}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">{label}</CardTitle>
                <p className="text-xs text-muted-foreground">{description}</p>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-5 gap-2 text-center">
                  <div>
                    <div className="text-xs text-muted-foreground">Active</div>
                    <div className={`text-lg font-bold ${counts.active > 0 ? "text-blue-600" : ""}`}>
                      {counts.active}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Wait</div>
                    <div className={`text-lg font-bold ${counts.waiting > 0 ? "text-amber-600" : ""}`}>
                      {counts.waiting}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Done</div>
                    <div className="text-lg font-bold text-green-600">{counts.completed}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Failed</div>
                    <div className={`text-lg font-bold ${counts.failed > 0 ? "text-red-600" : ""}`}>
                      {counts.failed}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Delay</div>
                    <div className="text-lg font-bold">{counts.delayed}</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
