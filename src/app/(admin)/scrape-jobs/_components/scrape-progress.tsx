"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Globe,
  FileSearch,
  Download,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Pause,
  Square,
  Cpu,
  Coins,
} from "lucide-react";

interface ScrapeProgressData {
  status: string;
  boardCode: string;
  pagesVisited: number;
  pagesTotal: number;
  pdfsProcessed: number;
  pdfsTotal: number;
  chaptersFound: number;
  topicsFound: number;
  currentPdf?: string;
  errorsCount: number;
  startedAt: string;
  aiModel?: string;
  tokensSoFar: number;
  costSoFar: number;
  aiProvider: string;
}

interface ProgressResponse {
  state: string | null;
  progress: ScrapeProgressData | null;
  failedReason: string | null;
}

interface ScrapeProgressProps {
  queueJobId: string;
  dbJobId: number;
  onComplete: () => void;
}

const PHASE_CONFIG: Record<
  string,
  { label: string; icon: React.ReactNode; color: string }
> = {
  queued: {
    label: "Queued",
    icon: <Loader2 className="size-3.5 animate-spin" />,
    color: "text-muted-foreground",
  },
  fetching_index: {
    label: "Fetching board index",
    icon: <Globe className="size-3.5" />,
    color: "text-blue-600",
  },
  downloading_pdfs: {
    label: "Downloading PDFs",
    icon: <Download className="size-3.5" />,
    color: "text-violet-600",
  },
  parsing: {
    label: "Parsing with AI",
    icon: <FileSearch className="size-3.5" />,
    color: "text-purple-600",
  },
  completed: {
    label: "Completed",
    icon: <CheckCircle2 className="size-3.5" />,
    color: "text-green-600",
  },
  failed: {
    label: "Failed",
    icon: <AlertCircle className="size-3.5" />,
    color: "text-red-600",
  },
};

function getProviderLabel(provider: string): string {
  switch (provider) {
    case "anthropic": return "Claude";
    case "gemini": return "Gemini";
    case "mistral": return "Mistral";
    case "auto": return "Auto (rotation)";
    default: return provider;
  }
}

export function ScrapeProgress({
  queueJobId,
  dbJobId,
  onComplete,
}: ScrapeProgressProps) {
  const [data, setData] = useState<ProgressResponse | null>(null);
  const [controlling, setControlling] = useState(false);
  const completedRef = useRef(false);

  const fetchProgress = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/admin/scrape-jobs/${queueJobId}/progress`
      );
      const json = await res.json();
      if (json.success) {
        setData(json.data);
      }
    } catch {
      // Silently ignore
    }
  }, [queueJobId]);

  useEffect(() => {
    if (!queueJobId) return;
    fetchProgress();
    const interval = setInterval(fetchProgress, 2000);
    return () => clearInterval(interval);
  }, [queueJobId, fetchProgress]);

  useEffect(() => {
    const status = data?.progress?.status;
    if (
      (status === "completed" || status === "failed") &&
      !completedRef.current
    ) {
      completedRef.current = true;
      queueMicrotask(() => onComplete());
    }
  }, [data?.progress?.status, onComplete]);

  async function controlJob(action: "pause" | "cancel") {
    setControlling(true);
    try {
      await fetch(`/api/admin/scrape-jobs/${dbJobId}/control`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, queueJobId }),
      });
      if (action === "cancel") {
        onComplete();
      }
    } catch {
      // Ignore
    } finally {
      setControlling(false);
    }
  }

  const progress = data?.progress;

  if (!progress) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Initializing job...
      </div>
    );
  }

  const phase = PHASE_CONFIG[progress.status] ?? {
    label: "Processing",
    icon: <Loader2 className="size-3.5 animate-spin" />,
    color: "text-blue-600",
  };
  const percent =
    progress.pdfsTotal > 0
      ? Math.round((progress.pdfsProcessed / progress.pdfsTotal) * 100)
      : 0;

  const isActive =
    progress.status !== "completed" && progress.status !== "failed";

  return (
    <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
      {/* Phase header + controls */}
      <div className="flex items-center justify-between">
        <div className={`flex items-center gap-2 text-sm font-medium ${phase.color}`}>
          {phase.icon}
          {phase.label}
        </div>
        <div className="flex items-center gap-2">
          {isActive && progress.pdfsTotal > 0 && (
            <span className="text-xs text-muted-foreground">{percent}%</span>
          )}
          {isActive && (
            <>
              <Button
                variant="outline"
                size="icon"
                className="size-7"
                onClick={() => controlJob("pause")}
                disabled={controlling}
                title="Pause"
              >
                <Pause className="size-3" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="size-7 text-destructive hover:text-destructive"
                onClick={() => controlJob("cancel")}
                disabled={controlling}
                title="Cancel"
              >
                <Square className="size-3" />
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Progress bar */}
      {isActive && progress.pdfsTotal > 0 && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-violet-600 transition-all duration-300"
            style={{ width: `${percent}%` }}
          />
        </div>
      )}

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
        <div>
          <span className="text-muted-foreground">PDFs: </span>
          <span className="font-medium">
            {progress.pdfsProcessed}
            {progress.pdfsTotal > 0 ? `/${progress.pdfsTotal}` : ""}
          </span>
        </div>
        <div>
          <span className="text-muted-foreground">Chapters: </span>
          <span className="font-medium text-green-600">{progress.chaptersFound}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Topics: </span>
          <span className="font-medium text-violet-600">{progress.topicsFound}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Errors: </span>
          <span className={`font-medium ${progress.errorsCount > 0 ? "text-red-600" : ""}`}>
            {progress.errorsCount}
          </span>
        </div>
      </div>

      {/* AI provider + cost info */}
      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <Cpu className="size-3" />
          AI: {getProviderLabel(progress.aiProvider)}
          {progress.aiModel && ` (${progress.aiModel})`}
        </span>
        {progress.tokensSoFar > 0 && (
          <span>
            {progress.tokensSoFar > 1000
              ? `${(progress.tokensSoFar / 1000).toFixed(1)}K`
              : progress.tokensSoFar}{" "}
            tokens
          </span>
        )}
        {progress.costSoFar > 0 && (
          <span className="flex items-center gap-1">
            <Coins className="size-3" />${progress.costSoFar.toFixed(4)}
          </span>
        )}
      </div>

      {/* Current PDF */}
      {progress.currentPdf && isActive && (
        <p className="truncate text-xs text-muted-foreground">
          Processing: {progress.currentPdf}
        </p>
      )}

      {/* Failed reason */}
      {data?.failedReason && (
        <p className="text-xs text-red-600">Error: {data.failedReason}</p>
      )}
    </div>
  );
}
