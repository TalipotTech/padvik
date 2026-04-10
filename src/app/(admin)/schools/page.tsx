"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { School, Search, Download, CheckCircle, Star, MapPin, Users, Loader2, BookOpen } from "lucide-react";
import { toast } from "sonner";

interface SchoolItem {
  id: number; name: string; slug: string | null; boardCode: string | null;
  district: string | null; state: string | null; city: string | null;
  managementType: string | null; classesFrom: number | null; classesTo: number | null;
  studentCount: number | null; isPartner: boolean; isVerified: boolean;
}

interface Stats {
  totalSchools: number; partnerCount: number;
  byBoard: { boardCode: string; count: number }[];
  byState: { state: string; count: number }[];
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
  const [importing, setImporting] = useState(false);

  useEffect(() => { fetchStats(); }, []);
  useEffect(() => { fetchSchools(); }, [query, stateFilter, boardFilter, offset]);

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
    if (data.success) {
      setSchools(data.data.items);
      setTotal(data.data.pagination.total);
    }
    setLoading(false);
  }

  async function triggerImport(source: string) {
    setImporting(true);
    const res = await fetch("/api/admin/schools/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source }),
    });
    const data = await res.json();
    setImporting(false);
    if (data.success) toast.success(`Import queued: ${source} (Job: ${data.data.jobId})`);
    else toast.error(data.error?.message || "Import failed");
  }

  async function toggleVerified(id: number, current: boolean) {
    await fetch(`/api/admin/schools/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isVerified: !current }),
    });
    fetchSchools();
  }

  async function togglePartner(id: number, current: boolean) {
    await fetch(`/api/admin/schools/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isPartner: !current }),
    });
    fetchSchools();
    fetchStats();
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Schools Directory</h1>
          <p className="text-sm text-muted-foreground">{total.toLocaleString()} schools in database</p>
        </div>
        <Dialog>
          <DialogTrigger asChild>
            <Button className="gap-2"><Download className="h-4 w-4" />Import Schools</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Import Schools</DialogTitle></DialogHeader>
            <div className="space-y-3">
              {[
                { source: "cbse_github", label: "CBSE from GitHub", desc: "~20K schools, pre-scraped CSV" },
                { source: "sametham", label: "Kerala (Sametham)", desc: "~15K Kerala schools" },
                { source: "cbse_saras", label: "CBSE SARAS (slow)", desc: "Official CBSE directory refresh" },
                { source: "icse_scrape", label: "ICSE (CISCE)", desc: "~2.6K ICSE/ISC schools" },
              ].map(s => (
                <Button key={s.source} variant="outline" className="w-full justify-start gap-3 h-auto py-3" disabled={importing} onClick={() => triggerImport(s.source)}>
                  {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  <div className="text-left"><p className="text-sm font-medium">{s.label}</p><p className="text-xs text-muted-foreground">{s.desc}</p></div>
                </Button>
              ))}
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Stats cards */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Card><CardContent className="py-4 text-center"><p className="text-2xl font-bold">{stats.totalSchools.toLocaleString()}</p><p className="text-xs text-muted-foreground">Total Schools</p></CardContent></Card>
          <Card><CardContent className="py-4 text-center"><p className="text-2xl font-bold">{stats.partnerCount}</p><p className="text-xs text-muted-foreground">Partners</p></CardContent></Card>
          <Card><CardContent className="py-4 text-center"><p className="text-2xl font-bold">{stats.byBoard.length}</p><p className="text-xs text-muted-foreground">Boards</p></CardContent></Card>
          <Card><CardContent className="py-4 text-center"><p className="text-2xl font-bold">{stats.byState.length}</p><p className="text-xs text-muted-foreground">States</p></CardContent></Card>
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
          <p>No schools found. Import data using the button above.</p>
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
                    {s.studentCount && <span className="text-[10px] text-muted-foreground"><Users className="h-3 w-3 inline mr-0.5" />{s.studentCount}</span>}
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

          {/* Pagination */}
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
