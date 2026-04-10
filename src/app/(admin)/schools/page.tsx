"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Search, Download, CheckCircle, Star, MapPin, Users, Loader2, School, RefreshCw, AlertCircle, Clock } from "lucide-react";
import { toast } from "sonner";

interface SchoolItem {
  id: number; name: string; boardCode: string | null;
  district: string | null; state: string | null;
  managementType: string | null; classesFrom: number | null; classesTo: number | null;
  studentCount: number | null; isPartner: boolean; isVerified: boolean;
}

interface Stats {
  totalSchools: number; partnerCount: number;
  byBoard: { boardCode: string; count: number }[];
  byState: { state: string; count: number }[];
}

interface JobInfo {
  id: string; source: string; state: string;
  progress: unknown; result: unknown; failedReason?: string;
  startedAt?: number; finishedAt?: number;
}

const SOURCES = [
  { id: "cbse_github", label: "CBSE (GitHub)", desc: "~20K schools, pre-scraped CSV", time: "~2 min" },
  { id: "sametham", label: "Kerala (Sametham)", desc: "~15K Kerala schools", time: "~10 min" },
  { id: "icse_scrape", label: "ICSE (CISCE)", desc: "~2.6K ICSE/ISC schools", time: "~5 min" },
  { id: "cbse_saras", label: "CBSE SARAS (slow)", desc: "Official CBSE refresh", time: "~hours" },
];

function JobStatusBadge({ state }: { state: string }) {
  switch (state) {
    case "active": return <Badge className="gap-1 text-xs bg-blue-500"><Loader2 className="h-3 w-3 animate-spin" />Running</Badge>;
    case "completed": return <Badge className="gap-1 text-xs bg-green-500"><CheckCircle className="h-3 w-3" />Done</Badge>;
    case "failed": return <Badge variant="destructive" className="gap-1 text-xs"><AlertCircle className="h-3 w-3" />Failed</Badge>;
    case "waiting": return <Badge variant="secondary" className="gap-1 text-xs"><Clock className="h-3 w-3" />Queued</Badge>;
    default: return <Badge variant="outline" className="text-xs">{state}</Badge>;
  }
}

export default function AdminSchoolsPage() {
  const [schools, setSchools] = useState<SchoolItem[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [boardFilter, setBoardFilter] = useState("");
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [jobs, setJobs] = useState<JobInfo[]>([]);
  const [dbCounts, setDbCounts] = useState<Record<string, number>>({});
  const [triggeringSource, setTriggeringSource] = useState<string | null>(null);

  const anyActive = jobs.some(j => j.state === "active" || j.state === "waiting");

  useEffect(() => { fetchStats(); fetchImportStatus(); }, []);
  useEffect(() => { fetchSchools(); }, [query, stateFilter, boardFilter, offset]);

  // Poll while import dialog is open or jobs are active
  useEffect(() => {
    if (!anyActive && !importDialogOpen) return;
    const interval = setInterval(() => {
      fetchImportStatus();
      if (anyActive) { fetchStats(); fetchSchools(); }
    }, 5000);
    return () => clearInterval(interval);
  }, [anyActive, importDialogOpen]);

  async function fetchStats() {
    const res = await fetch("/api/schools/stats");
    const data = await res.json();
    if (data.success) setStats(data.data);
  }

  async function fetchSchools() {
    setLoading(true);
    const params = new URLSearchParams({ limit: "20", offset: String(offset) });
    if (query) params.set("q", query);
    if (stateFilter) params.set("state", stateFilter);
    if (boardFilter) params.set("boardCode", boardFilter);
    const res = await fetch(`/api/schools?${params}`);
    const data = await res.json();
    if (data.success) { setSchools(data.data.items); setTotal(data.data.pagination.total); }
    setLoading(false);
  }

  async function fetchImportStatus() {
    try {
      const res = await fetch("/api/admin/schools/import");
      const data = await res.json();
      if (data.success) {
        setJobs(data.data.jobs || []);
        setDbCounts(data.data.dbCounts?.bySource || {});
      }
    } catch { /* Redis may be down */ }
  }

  async function triggerImport(source: string) {
    setTriggeringSource(source);
    const res = await fetch("/api/admin/schools/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source }),
    });
    const data = await res.json();
    setTriggeringSource(null);
    if (data.success) {
      toast.success(`Import queued: ${source} (Job ID: ${data.data.jobId})`);
      fetchImportStatus();
    } else {
      toast.error(data.error?.message || "Failed to queue import");
    }
  }

  function getSourceJob(sourceId: string): JobInfo | undefined {
    return jobs.find(j => j.source === sourceId);
  }

  async function toggleVerified(id: number, current: boolean) {
    await fetch(`/api/admin/schools/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isVerified: !current }) });
    fetchSchools();
  }

  async function togglePartner(id: number, current: boolean) {
    await fetch(`/api/admin/schools/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isPartner: !current }) });
    fetchSchools(); fetchStats();
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Schools Directory</h1>
          <p className="text-sm text-muted-foreground">{total.toLocaleString()} schools in database</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => { fetchStats(); fetchSchools(); fetchImportStatus(); }}>
            <RefreshCw className="h-3.5 w-3.5" />Refresh
          </Button>
          <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2"><Download className="h-4 w-4" />Import Schools</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle>Import Schools via Queue</DialogTitle></DialogHeader>
              <p className="text-xs text-muted-foreground mb-3">
                Jobs are queued via BullMQ and processed by workers. Make sure <code className="bg-muted px-1 rounded">pnpm workers</code> is running.
              </p>
              <div className="space-y-3">
                {SOURCES.map(s => {
                  const job = getSourceJob(s.id);
                  const count = dbCounts[s.id] || 0;
                  const isActive = job?.state === "active" || job?.state === "waiting";
                  return (
                    <div key={s.id} className="rounded-lg border p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium">{s.label}</p>
                          <p className="text-xs text-muted-foreground">{s.desc}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          {count > 0 && <Badge variant="outline" className="text-xs">{count.toLocaleString()} in DB</Badge>}
                          {job && <JobStatusBadge state={job.state} />}
                        </div>
                      </div>

                      {/* Job result details */}
                      {job?.state === "completed" && (
                        <p className="text-xs text-green-600">Completed</p>
                      )}
                      {job?.state === "failed" && job.failedReason && (
                        <p className="text-xs text-destructive truncate">{job.failedReason}</p>
                      )}

                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full gap-1.5"
                        disabled={isActive || triggeringSource === s.id}
                        onClick={() => triggerImport(s.id)}
                      >
                        {isActive ? (
                          <><Loader2 className="h-3.5 w-3.5 animate-spin" />Running...</>
                        ) : triggeringSource === s.id ? (
                          <><Loader2 className="h-3.5 w-3.5 animate-spin" />Queuing...</>
                        ) : (
                          <><Download className="h-3.5 w-3.5" />{count > 0 ? "Refresh" : "Import"} · {s.time}</>
                        )}
                      </Button>
                    </div>
                  );
                })}
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Card><CardContent className="py-4 text-center"><p className="text-2xl font-bold">{stats.totalSchools.toLocaleString()}</p><p className="text-xs text-muted-foreground">Total Schools</p></CardContent></Card>
          <Card><CardContent className="py-4 text-center"><p className="text-2xl font-bold">{stats.partnerCount}</p><p className="text-xs text-muted-foreground">Partners</p></CardContent></Card>
          <Card><CardContent className="py-4 text-center"><p className="text-2xl font-bold">{stats.byBoard.length}</p><p className="text-xs text-muted-foreground">Boards</p></CardContent></Card>
          <Card><CardContent className="py-4 text-center"><p className="text-2xl font-bold">{stats.byState.length}</p><p className="text-xs text-muted-foreground">States</p></CardContent></Card>
        </div>
      )}

      {/* Active job banner */}
      {anyActive && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 dark:bg-blue-950/20 dark:border-blue-800 p-4 flex items-center gap-3">
          <Loader2 className="h-5 w-5 text-blue-600 animate-spin shrink-0" />
          <div>
            <p className="text-sm font-medium text-blue-800 dark:text-blue-300">Import in progress</p>
            <p className="text-xs text-blue-600 dark:text-blue-400">
              {jobs.filter(j => j.state === "active").map(j => j.source).join(", ") || "Waiting in queue..."}
            </p>
          </div>
        </div>
      )}

      {/* Search + filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-10" placeholder="Search schools..." value={query} onChange={e => { setQuery(e.target.value); setOffset(0); }} />
        </div>
        <select className="h-10 rounded-md border bg-background px-3 text-sm" value={stateFilter} onChange={e => { setStateFilter(e.target.value); setOffset(0); }}>
          <option value="">All States</option>
          {stats?.byState.map(s => <option key={s.state} value={s.state}>{s.state} ({s.count})</option>)}
        </select>
        <select className="h-10 rounded-md border bg-background px-3 text-sm" value={boardFilter} onChange={e => { setBoardFilter(e.target.value); setOffset(0); }}>
          <option value="">All Boards</option>
          {stats?.byBoard.map(b => <option key={b.boardCode} value={b.boardCode}>{b.boardCode} ({b.count})</option>)}
        </select>
      </div>

      {/* Results */}
      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
      ) : schools.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">
          <School className="h-10 w-10 mx-auto mb-3" />
          <p>No schools found.</p>
          <p className="text-xs mt-1">Click "Import Schools" above and ensure <code className="bg-muted px-1 rounded">pnpm workers</code> is running.</p>
        </CardContent></Card>
      ) : (
        <div className="space-y-2">
          {schools.map(s => (
            <Card key={s.id}>
              <CardContent className="flex items-center gap-4 py-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{s.name}</p>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    {s.boardCode && <Badge variant="outline" className="text-[10px] py-0 h-5">{s.boardCode}</Badge>}
                    {s.managementType && <Badge variant="secondary" className="text-[10px] py-0 h-5 capitalize">{s.managementType}</Badge>}
                    {s.classesFrom && s.classesTo && <span className="text-[10px] text-muted-foreground">Class {s.classesFrom}-{s.classesTo}</span>}
                    {s.studentCount && <span className="text-[10px] text-muted-foreground"><Users className="h-3 w-3 inline mr-0.5" />{s.studentCount.toLocaleString()}</span>}
                  </div>
                  {(s.district || s.state) && (
                    <div className="flex items-center gap-1 mt-0.5 text-xs text-muted-foreground">
                      <MapPin className="h-3 w-3" />{[s.district, s.state].filter(Boolean).join(", ")}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button variant="ghost" size="icon" className="h-7 w-7" title={s.isVerified ? "Unverify" : "Verify"} onClick={() => toggleVerified(s.id, s.isVerified)}>
                    <CheckCircle className={`h-4 w-4 ${s.isVerified ? "text-green-500" : "text-muted-foreground"}`} />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7" title={s.isPartner ? "Remove Partner" : "Make Partner"} onClick={() => togglePartner(s.id, s.isPartner)}>
                    <Star className={`h-4 w-4 ${s.isPartner ? "text-yellow-500 fill-yellow-500" : "text-muted-foreground"}`} />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
          <div className="flex items-center justify-center gap-2 pt-4">
            <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 20))}>Previous</Button>
            <span className="text-sm text-muted-foreground">{offset + 1}–{Math.min(offset + 20, total)} of {total.toLocaleString()}</span>
            <Button variant="outline" size="sm" disabled={offset + 20 >= total} onClick={() => setOffset(offset + 20)}>Next</Button>
          </div>
        </div>
      )}
    </div>
  );
}
