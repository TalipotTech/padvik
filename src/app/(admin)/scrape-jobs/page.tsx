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
}

export default function ScrapeJobsPage() {
  const [jobs, setJobs] = useState<ScrapeJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [maxPdfs, setMaxPdfs] = useState("3");
  const [selectedGrade, setSelectedGrade] = useState("all");
  const [error, setError] = useState<string | null>(null);

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
    // Poll every 5s if any job is running
    const interval = setInterval(() => {
      if (jobs.some((j) => j.status === "running" || j.status === "queued")) {
        fetchJobs();
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [fetchJobs, jobs]);

  async function triggerScrape() {
    setTriggering(true);
    setError(null);

    const grades =
      selectedGrade === "all"
        ? undefined
        : [parseInt(selectedGrade, 10)];

    try {
      const res = await fetch("/api/admin/scrape-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          boardCode: "CBSE",
          jobType: "syllabus",
          grades,
          maxPdfs: parseInt(maxPdfs, 10) || 3,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error?.message ?? "Failed to trigger scrape");
      } else {
        fetchJobs();
      }
    } catch {
      setError("Network error");
    } finally {
      setTriggering(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Scrape Jobs</h1>
        <p className="text-muted-foreground">
          Trigger and monitor syllabus scraping from Indian education board websites.
        </p>
      </div>

      {/* Trigger new scrape */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Trigger CBSE Scrape</CardTitle>
          <CardDescription>
            Downloads syllabus PDFs from cbseacademic.nic.in, extracts text, and parses
            chapters/topics using Claude AI.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-2">
              <Label htmlFor="grade">Grade</Label>
              <Select value={selectedGrade} onValueChange={setSelectedGrade}>
                <SelectTrigger id="grade" className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All grades</SelectItem>
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
                max={100}
                value={maxPdfs}
                onChange={(e) => setMaxPdfs(e.target.value)}
                className="w-[100px]"
              />
            </div>

            <Button onClick={triggerScrape} disabled={triggering}>
              {triggering ? "Starting..." : "Start Scrape"}
            </Button>
          </div>
          {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>

      {/* Jobs list */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg">Job History</CardTitle>
          <Button variant="outline" size="sm" onClick={fetchJobs}>
            Refresh
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : jobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No scrape jobs yet. Trigger one above.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2 pr-4">ID</th>
                    <th className="pb-2 pr-4">Type</th>
                    <th className="pb-2 pr-4">Status</th>
                    <th className="pb-2 pr-4">Progress</th>
                    <th className="pb-2 pr-4">Started</th>
                    <th className="pb-2 pr-4">Duration</th>
                    <th className="pb-2">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((job) => (
                    <tr key={job.id} className="border-b last:border-0">
                      <td className="py-3 pr-4 font-mono text-xs">{job.id}</td>
                      <td className="py-3 pr-4">{job.jobType}</td>
                      <td className="py-3 pr-4">
                        <StatusBadge status={job.status} />
                      </td>
                      <td className="py-3 pr-4">
                        {job.itemsProcessed}/{job.itemsFound || "?"}
                      </td>
                      <td className="py-3 pr-4 text-xs text-muted-foreground">
                        {job.startedAt
                          ? new Date(job.startedAt).toLocaleTimeString()
                          : "—"}
                      </td>
                      <td className="py-3 pr-4 text-xs text-muted-foreground">
                        {formatDuration(job.startedAt, job.completedAt)}
                      </td>
                      <td className="max-w-[200px] truncate py-3 text-xs text-destructive">
                        {job.errorLog || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    queued: "bg-muted text-muted-foreground",
    running: "bg-warning/15 text-warning",
    completed: "bg-success/15 text-success",
    failed: "bg-destructive/15 text-destructive",
  };

  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${styles[status] ?? styles.queued}`}
    >
      {status}
    </span>
  );
}

function formatDuration(start: string | null, end: string | null): string {
  if (!start) return "—";
  const s = new Date(start).getTime();
  const e = end ? new Date(end).getTime() : Date.now();
  const seconds = Math.round((e - s) / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
