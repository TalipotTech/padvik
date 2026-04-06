"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { ScrapeProgress } from "./_components/scrape-progress";
import { QueueDashboard } from "./_components/queue-dashboard";
import { AIUsagePanel } from "./_components/ai-usage-panel";
import { ParseErrorsPanel } from "./_components/parse-errors-panel";
import { ScrapedContentPanel } from "./_components/scraped-content-panel";
import Link from "next/link";
import {
  Globe,
  Cpu,
  Clock,
  Hash,
  Play,
  Pause,
  Square,
  RotateCcw,
  Trash2,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  BookOpen,
  Loader2,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface JobMetadata {
  boardCode?: string;
  aiProvider?: string;
  grades?: number[] | null;
  maxPdfs?: number | null;
  queueJobId?: string;
  triggeredBy?: string;
  triggeredAt?: string;
  restartedFrom?: number;
}

interface ScrapeJob {
  id: number;
  jobType: string;
  sourceUrl: string;
  boardId: number | null;
  status: string;
  itemsFound: number;
  itemsProcessed: number;
  errorLog: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  metadata: JobMetadata | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const BOARDS = [
  { code: "CBSE", label: "CBSE", url: "cbseacademic.nic.in" },
  { code: "ICSE", label: "ICSE", url: "cisce.org" },
  { code: "KL_SCERT", label: "Kerala SCERT", url: "scert.kerala.gov.in" },
] as const;

const AI_PROVIDERS = [
  { value: "auto", label: "Auto (Rotate)", description: "Cost-optimized: Gemini 2.5 Flash → Pro → Mistral → Claude" },
  { value: "gemini", label: "Google Gemini", description: "Gemini 2.5 Pro — best for Indian languages (Hindi, Tamil, etc.)" },
  { value: "anthropic", label: "Anthropic Claude", description: "Claude Sonnet 4 — highest quality English extraction" },
  { value: "mistral", label: "Mistral AI", description: "Mistral Large — strong multilingual" },
  { value: "openai", label: "OpenAI GPT-4o", description: "GPT-4o — reliable general purpose" },
  { value: "perplexity", label: "Perplexity Sonar", description: "Sonar — web-grounded search" },
] as const;

const BOARD_LABELS: Record<string, string> = {
  CBSE: "CBSE",
  ICSE: "ICSE",
  KL_SCERT: "Kerala SCERT",
};

const PROVIDER_LABELS: Record<string, string> = {
  auto: "Auto (Rotation)",
  anthropic: "Anthropic Claude",
  gemini: "Google Gemini",
  mistral: "Mistral AI",
  openai: "OpenAI GPT-4o",
  perplexity: "Perplexity Sonar",
};

// ---------------------------------------------------------------------------
// Page Component
// ---------------------------------------------------------------------------
export default function ScrapeJobsPage() {
  const [jobs, setJobs] = useState<ScrapeJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [maxPdfs, setMaxPdfs] = useState("3");
  const [selectedGrade, setSelectedGrade] = useState("all");
  const [selectedBoard, setSelectedBoard] = useState("CBSE");
  const [selectedJobType, setSelectedJobType] = useState("syllabus");
  const [retrySkipped, setRetrySkipped] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState("auto");
  const [jobTypeFilter, setJobTypeFilter] = useState("all");

  // Auto-sync job type with filter
  const handleJobTypeFilterChange = (filter: string) => {
    setJobTypeFilter(filter);
    if (filter !== "all") {
      setSelectedJobType(filter);
    }
  };
  const [error, setError] = useState<string | null>(null);
  const [activeJobs, setActiveJobs] = useState<Record<number, string>>({});
  const [expandedJob, setExpandedJob] = useState<number | null>(null);

  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/scrape-jobs");
      const data = await res.json();
      if (data.success) {
        setJobs(data.data);
      }
    } catch {
      console.error("Failed to fetch jobs");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  // Filter jobs by selected type
  const filteredJobs = jobTypeFilter === "all"
    ? jobs
    : jobs.filter((j) => j.jobType === jobTypeFilter);

  useEffect(() => {
    const hasActive = jobs.some(
      (j) => j.status === "running" || j.status === "queued"
    );
    if (!hasActive) return;
    const interval = setInterval(fetchJobs, 5000);
    return () => clearInterval(interval);
  }, [jobs, fetchJobs]);

  function parseGrades(): number[] | undefined {
    if (selectedGrade === "all") return undefined;
    // Handle multi-grade like "9,10" or "11,12"
    if (selectedGrade.includes(",")) {
      return selectedGrade.split(",").map((s) => parseInt(s.trim(), 10));
    }
    return [parseInt(selectedGrade, 10)];
  }

  async function triggerScrape() {
    setTriggering(true);
    setError(null);

    const grades = parseGrades();

    try {
      const res = await fetch("/api/admin/scrape-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          boardCode: selectedBoard,
          jobType: selectedJobType,
          grades,
          maxPdfs: parseInt(maxPdfs, 10) || 150,
          retrySkipped: retrySkipped || undefined,
          aiProvider: selectedProvider,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error?.message ?? "Failed to trigger scrape");
      } else {
        const queueJobId = data.data?.queueJobId ?? data.data?.metadata?.queueJobId;
        if (queueJobId) {
          setActiveJobs((prev) => ({
            ...prev,
            [data.data.id]: queueJobId,
          }));
        }
        fetchJobs();
      }
    } catch {
      setError("Network error — is Redis running?");
    } finally {
      setTriggering(false);
    }
  }

  /** Scrape complete curriculum — fires 2 jobs: Sec (9-10) + SrSec (11-12) */
  async function triggerFullScrape() {
    setTriggering(true);
    setError(null);

    const batches = [
      { grades: [9, 10], label: "Secondary (9-10)" },
      { grades: [11, 12], label: "Sr. Secondary (11-12)" },
    ];

    const results: string[] = [];

    for (const batch of batches) {
      try {
        const res = await fetch("/api/admin/scrape-jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            boardCode: selectedBoard,
            jobType: "syllabus",
            grades: batch.grades,
            maxPdfs: 200,
            aiProvider: selectedProvider,
          }),
        });
        const data = await res.json();
        if (data.success) {
          results.push(`${batch.label}: Job #${data.data.id} queued`);
          const queueJobId = data.data?.queueJobId ?? data.data?.metadata?.queueJobId;
          if (queueJobId) {
            setActiveJobs((prev) => ({
              ...prev,
              [data.data.id]: queueJobId,
            }));
          }
        } else {
          results.push(`${batch.label}: ${data.error?.message ?? "Failed"}`);
        }
      } catch {
        results.push(`${batch.label}: Network error`);
      }
    }

    setError(results.join(" | "));
    fetchJobs();
    setTriggering(false);
  }

  function handleJobComplete(jobId: number) {
    setActiveJobs((prev) => {
      const next = { ...prev };
      delete next[jobId];
      return next;
    });
    fetchJobs();
  }

  async function controlJob(
    jobId: number,
    action: "pause" | "resume" | "cancel" | "restart" | "delete",
    queueJobId?: string
  ) {
    try {
      const res = await fetch(`/api/admin/scrape-jobs/${jobId}/control`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, queueJobId }),
      });
      const data = await res.json();
      if (data.success && action === "restart" && data.data?.queueJobId) {
        setActiveJobs((prev) => ({
          ...prev,
          [data.data.jobId]: data.data.queueJobId,
        }));
      }
      fetchJobs();
    } catch {
      // Ignore
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Scrape Pipeline</h1>
        <p className="text-muted-foreground">
          Scrape syllabi, question papers, and textbooks from Indian education board websites.
        </p>
      </div>

      {/* Job type filter */}
      <div className="flex items-center gap-1 rounded-lg bg-muted p-1 w-fit">
        {[
          { value: "all", label: "All Types" },
          { value: "syllabus", label: "Syllabus" },
          { value: "question_paper", label: "Questions" },
          { value: "textbook", label: "Textbooks" },
        ].map((t) => (
          <button
            key={t.value}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              jobTypeFilter === t.value
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => handleJobTypeFilterChange(t.value)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <Tabs defaultValue="jobs" className="space-y-6">
        <TabsList>
          <TabsTrigger value="jobs">
            Jobs
            {jobs.filter((j) => j.status === "running" || j.status === "queued").length > 0 && (
              <span className="ml-1.5 inline-flex size-5 items-center justify-center rounded-full bg-blue-500 text-[10px] font-bold text-white">
                {jobs.filter((j) => j.status === "running" || j.status === "queued").length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="queues">Queue Status</TabsTrigger>
          <TabsTrigger value="ai-usage">AI Usage</TabsTrigger>
          <TabsTrigger value="parse-errors">Parse Errors</TabsTrigger>
          <TabsTrigger value="content">Scraped Content</TabsTrigger>
        </TabsList>

        {/* ============== TAB 1: Jobs ============== */}
        <TabsContent value="jobs" className="space-y-6">
          {/* Trigger form */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Trigger New Scrape</CardTitle>
              <CardDescription>
                Configure board, grade, AI provider and start. Duplicate jobs for the same board are prevented.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap items-end gap-4">
                <div className="space-y-2">
                  <Label htmlFor="board">Board</Label>
                  <Select value={selectedBoard} onValueChange={setSelectedBoard}>
                    <SelectTrigger id="board" className="w-[160px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {BOARDS.map((b) => (
                        <SelectItem key={b.code} value={b.code}>
                          {b.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="jobType">Job Type</Label>
                  <Select value={selectedJobType} onValueChange={setSelectedJobType}>
                    <SelectTrigger id="jobType" className="w-[180px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="syllabus">Syllabus</SelectItem>
                      <SelectItem value="question_paper">Question Papers</SelectItem>
                      <SelectItem value="textbook">Textbook</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="grade">Grade</Label>
                  <Select value={selectedGrade} onValueChange={setSelectedGrade}>
                    <SelectTrigger id="grade" className="w-[140px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All grades</SelectItem>
                      <SelectItem value="9,10">Classes 9-10 (Secondary)</SelectItem>
                      <SelectItem value="11,12">Classes 11-12 (Sr. Secondary)</SelectItem>
                      {Array.from({ length: 12 }, (_, i) => (
                        <SelectItem key={i + 1} value={String(i + 1)}>
                          Class {i + 1}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="maxPdfs">Max PDFs</Label>
                  <Input
                    id="maxPdfs"
                    type="number"
                    min={1}
                    max={500}
                    value={maxPdfs}
                    onChange={(e) => setMaxPdfs(e.target.value)}
                    className="w-[100px]"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="aiProvider">AI Provider</Label>
                  <Select value={selectedProvider} onValueChange={setSelectedProvider}>
                    <SelectTrigger id="aiProvider" className="w-[200px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {AI_PROVIDERS.map((p) => (
                        <SelectItem key={p.value} value={p.value}>
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <label className="flex items-center gap-2 cursor-pointer self-end pb-2">
                  <input
                    type="checkbox"
                    checked={retrySkipped}
                    onChange={(e) => setRetrySkipped(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300"
                  />
                  <span className="text-xs text-muted-foreground whitespace-nowrap">Retry skipped only</span>
                </label>

                <Button onClick={triggerScrape} disabled={triggering}>
                  {triggering ? (
                    <>
                      <Loader2 className="mr-2 size-4 animate-spin" />
                      Queuing...
                    </>
                  ) : (
                    <>
                      <Play className="mr-2 size-4" />
                      Start Scrape
                    </>
                  )}
                </Button>
              </div>

              {/* Board info + Scrape All button */}
              <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-1.5 text-xs text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <Globe className="size-3" />
                    Source: {BOARDS.find((b) => b.code === selectedBoard)?.url}
                  </div>
                  <div className="flex items-center gap-1">
                    <Cpu className="size-3" />
                    {AI_PROVIDERS.find((p) => p.value === selectedProvider)?.description}
                  </div>
                </div>

                {/* Quick-action: Scrape Complete Curriculum */}
                <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                  <div className="text-xs font-medium">Scrape Complete Curriculum</div>
                  <p className="text-[10px] text-muted-foreground max-w-xs">
                    CBSE has ~147 subject PDFs: 66 for Classes 9-10 and 81 for Classes 11-12.
                    This creates 2 batch jobs. Estimated: ~86 min, ~$0.15 with GPT-4o-mini.
                  </p>
                  <Button
                    variant="default"
                    size="sm"
                    className="text-xs"
                    onClick={triggerFullScrape}
                    disabled={triggering}
                  >
                    {triggering ? (
                      <Loader2 className="mr-1.5 size-3 animate-spin" />
                    ) : (
                      <Play className="mr-1.5 size-3" />
                    )}
                    Scrape All {BOARDS.find((b) => b.code === selectedBoard)?.label} PDFs
                  </Button>
                </div>
              </div>

              {error && (
                <div className="mt-3 flex items-start gap-2 text-sm">
                  <AlertCircle className="size-4 mt-0.5 shrink-0 text-amber-500" />
                  <span className="text-xs">{error}</span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Active job progress cards */}
          {Object.entries(activeJobs).map(([jobIdStr, queueJobId]) => {
            const jobId = parseInt(jobIdStr, 10);
            const job = jobs.find((j) => j.id === jobId);
            const meta = job?.metadata;
            return (
              <Card key={jobId} className="border-blue-200 dark:border-blue-800">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm">
                      Job #{jobId} — {BOARD_LABELS[meta?.boardCode ?? ""] ?? inferBoard(job?.sourceUrl ?? "")} Syllabus Scrape
                    </CardTitle>
                    <StatusBadge status={job?.status ?? "running"} />
                  </div>
                  <div className="flex gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Globe className="size-3" />
                      {job?.sourceUrl}
                    </span>
                    <span className="flex items-center gap-1">
                      <Cpu className="size-3" />
                      {PROVIDER_LABELS[meta?.aiProvider ?? "auto"]}
                    </span>
                  </div>
                </CardHeader>
                <CardContent>
                  <ScrapeProgress
                    queueJobId={queueJobId}
                    dbJobId={jobId}
                    onComplete={() => handleJobComplete(jobId)}
                  />
                </CardContent>
              </Card>
            );
          })}

          {/* Job history */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-lg">Job History</CardTitle>
                <CardDescription>
                  {filteredJobs.length} jobs{jobTypeFilter !== "all" ? ` (${jobTypeFilter.replace("_", " ")})` : ""} — {jobs.length} total
                </CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={fetchJobs}>
                Refresh
              </Button>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center gap-2 py-8 text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  Loading jobs...
                </div>
              ) : filteredJobs.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground">
                  <Globe className="mx-auto mb-2 size-8 opacity-30" />
                  <p>{jobTypeFilter === "all" ? "No scrape jobs yet. Trigger one above." : `No ${jobTypeFilter.replace("_", " ")} jobs found.`}</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredJobs.map((job) => (
                    <JobCard
                      key={job.id}
                      job={job}
                      isExpanded={expandedJob === job.id}
                      onToggle={() =>
                        setExpandedJob(expandedJob === job.id ? null : job.id)
                      }
                      onControl={(action) =>
                        controlJob(job.id, action, (job.metadata as JobMetadata)?.queueJobId)
                      }
                      isActive={!!activeJobs[job.id]}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ============== TAB 2: Queue Status ============== */}
        <TabsContent value="queues">
          <QueueDashboard jobTypeFilter={jobTypeFilter} />
        </TabsContent>

        {/* ============== TAB 3: AI Usage ============== */}
        <TabsContent value="ai-usage">
          <AIUsagePanel jobTypeFilter={jobTypeFilter} />
        </TabsContent>

        {/* ============== TAB 4: Parse Errors ============== */}
        <TabsContent value="parse-errors">
          <ParseErrorsPanel jobTypeFilter={jobTypeFilter} />
        </TabsContent>

        {/* ============== TAB 5: Scraped Content ============== */}
        <TabsContent value="content" className="space-y-4">
          <div className="flex justify-end">
            <Link href="/curriculum">
              <Button variant="outline" size="sm">
                <BookOpen className="mr-2 size-4" />
                Open Full Curriculum Explorer
              </Button>
            </Link>
          </div>
          <ScrapedContentPanel jobTypeFilter={jobTypeFilter} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Job Card Component — expandable with full details
// ---------------------------------------------------------------------------
function JobCard({
  job,
  isExpanded,
  onToggle,
  onControl,
  isActive,
}: {
  job: ScrapeJob;
  isExpanded: boolean;
  onToggle: () => void;
  onControl: (action: "pause" | "resume" | "cancel" | "restart" | "delete") => void;
  isActive: boolean;
}) {
  const meta = (job.metadata ?? {}) as JobMetadata;
  const boardLabel = BOARD_LABELS[meta.boardCode ?? ""] ?? inferBoard(job.sourceUrl);
  const isRunning = job.status === "running" || job.status === "queued";
  const isPaused = job.status === "paused";
  const isDone = job.status === "completed" || job.status === "failed" || job.status === "cancelled";

  return (
    <div className="rounded-lg border bg-card text-card-foreground">
      {/* Collapsed summary row */}
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-3 p-3 text-left hover:bg-muted/50"
      >
        <span className="font-mono text-xs text-muted-foreground w-8">#{job.id}</span>
        <span className="text-sm font-medium min-w-[80px]">{boardLabel}</span>
        <StatusBadge status={job.status} />
        <span className="text-xs text-muted-foreground">
          {job.itemsProcessed}/{job.itemsFound || "?"} PDFs
        </span>
        <span className="flex-1" />
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Cpu className="size-3" />
          {PROVIDER_LABELS[meta.aiProvider ?? "auto"] ?? "Auto"}
        </span>
        <span className="text-xs text-muted-foreground">
          {job.startedAt
            ? formatDuration(job.startedAt, job.completedAt)
            : "—"}
        </span>
        {isExpanded ? (
          <ChevronUp className="size-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="size-4 text-muted-foreground" />
        )}
      </button>

      {/* Expanded details */}
      {isExpanded && (
        <div className="border-t px-3 pb-3">
          <div className="grid grid-cols-2 gap-x-8 gap-y-2 py-3 text-sm sm:grid-cols-4">
            <div>
              <div className="text-xs text-muted-foreground">Source URL</div>
              <a
                href={job.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-blue-600 hover:underline"
              >
                {job.sourceUrl.replace(/^https?:\/\//, "").slice(0, 40)}
                <ExternalLink className="size-3" />
              </a>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Job Type</div>
              <div className="text-xs font-medium capitalize">{job.jobType.replace(/_/g, " ")}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">AI Provider</div>
              <div className="text-xs font-medium">
                {PROVIDER_LABELS[meta.aiProvider ?? "auto"]}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Board</div>
              <div className="text-xs font-medium">{boardLabel}</div>
            </div>

            <div>
              <div className="text-xs text-muted-foreground">Grades</div>
              <div className="text-xs font-medium">
                {meta.grades && meta.grades.length > 0
                  ? meta.grades.map((g) => `Class ${g}`).join(", ")
                  : "All (1–12)"}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Max PDFs</div>
              <div className="text-xs font-medium">{meta.maxPdfs ?? "Unlimited"}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Created</div>
              <div className="text-xs font-medium">
                {new Date(job.createdAt).toLocaleString()}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Duration</div>
              <div className="text-xs font-medium">
                {formatDuration(job.startedAt, job.completedAt)}
              </div>
            </div>

            <div>
              <div className="text-xs text-muted-foreground">PDFs Found</div>
              <div className="flex items-center gap-1 text-xs font-medium">
                <Hash className="size-3 text-muted-foreground" />
                {job.itemsFound || "—"}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">PDFs Processed</div>
              <div className="flex items-center gap-1 text-xs font-medium">
                <Hash className="size-3 text-muted-foreground" />
                {job.itemsProcessed}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Started</div>
              <div className="flex items-center gap-1 text-xs font-medium">
                <Clock className="size-3 text-muted-foreground" />
                {job.startedAt ? new Date(job.startedAt).toLocaleTimeString() : "—"}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Triggered By</div>
              <div className="text-xs font-medium">{meta.triggeredBy ?? "—"}</div>
            </div>
          </div>

          {/* Error log */}
          {job.errorLog && (
            <div className="rounded-md bg-red-50 p-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">
              <strong>Error:</strong> {job.errorLog}
            </div>
          )}

          {/* Restarted from badge */}
          {meta.restartedFrom && (
            <p className="mt-1 text-xs text-muted-foreground">
              Restarted from Job #{meta.restartedFrom}
            </p>
          )}

          <Separator className="my-3" />

          {/* Per-job action buttons */}
          <div className="flex flex-wrap gap-2">
            {isRunning && !isActive && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onControl("pause")}
              >
                <Pause className="mr-1.5 size-3" />
                Pause
              </Button>
            )}
            {isPaused && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onControl("resume")}
              >
                <Play className="mr-1.5 size-3" />
                Resume
              </Button>
            )}
            {(isRunning || isPaused) && (
              <Button
                variant="outline"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => onControl("cancel")}
              >
                <Square className="mr-1.5 size-3" />
                Cancel
              </Button>
            )}
            {isDone && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onControl("restart")}
              >
                <RotateCcw className="mr-1.5 size-3" />
                Restart
              </Button>
            )}
            {isDone && (
              <Button
                variant="outline"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => onControl("delete")}
              >
                <Trash2 className="mr-1.5 size-3" />
                Delete
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function inferBoard(sourceUrl: string): string {
  if (sourceUrl.includes("cbse") || sourceUrl.includes("CBSE")) return "CBSE";
  if (sourceUrl.includes("cisce") || sourceUrl.includes("ICSE")) return "ICSE";
  if (sourceUrl.includes("scert.kerala") || sourceUrl.includes("KL_SCERT")) return "Kerala";
  return "Unknown";
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { bg: string; dot: string; label: string }> = {
    queued: { bg: "bg-muted", dot: "bg-gray-400", label: "Queued" },
    running: { bg: "bg-blue-500/10", dot: "bg-blue-500 animate-pulse", label: "Running" },
    paused: { bg: "bg-amber-500/10", dot: "bg-amber-500", label: "Paused" },
    completed: { bg: "bg-green-500/10", dot: "bg-green-500", label: "Completed" },
    failed: { bg: "bg-red-500/10", dot: "bg-red-500", label: "Failed" },
    cancelled: { bg: "bg-muted", dot: "bg-gray-400", label: "Cancelled" },
  };
  const c = config[status] ?? config.queued;

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${c.bg}`}>
      <span className={`inline-block size-1.5 rounded-full ${c.dot}`} />
      {c.label}
    </span>
  );
}

function formatDuration(start: string | null, end: string | null): string {
  if (!start) return "—";
  const s = new Date(start).getTime();
  const e = end ? new Date(end).getTime() : Date.now();
  const seconds = Math.round((e - s) / 1000);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}
