"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Loader2, Inbox, HelpCircle, Clock, CheckCircle, MessageCircle } from "lucide-react";

interface Doubt {
  id: number;
  studentName: string;
  studentAvatar: string | null;
  questionText: string;
  status: string;
  createdAt: string;
}

function statusLabel(status: string): string {
  switch (status) {
    case "open": return "Needs Response";
    case "ai_answered": return "AI Answered — Review";
    case "creator_answered": return "You Responded";
    case "closed": return "Resolved";
    default: return status;
  }
}

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "open": return "destructive";
    case "ai_answered": return "outline";
    case "creator_answered": return "default";
    case "closed": return "secondary";
    default: return "outline";
  }
}

export default function CreatorDoubtsPage() {
  const [doubts, setDoubts] = useState<Doubt[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState<string>("");
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => { fetchDoubts(); fetchUnread(); }, [page, filter]);

  async function fetchDoubts() {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: "20" });
    if (filter) params.set("status", filter);
    const res = await fetch(`/api/doubts/inbox?${params}`);
    const data = await res.json();
    if (data.success) {
      setDoubts(data.data.items);
      setTotalPages(data.data.pagination.totalPages);
      setTotal(data.data.pagination.total);
    }
    setLoading(false);
  }

  async function fetchUnread() {
    const res = await fetch("/api/doubts/unread-count");
    const data = await res.json();
    if (data.success) setUnreadCount(data.data.count);
  }

  // Count by status
  const needsResponse = doubts.filter(d => d.status === "open" || d.status === "ai_answered").length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Inbox className="h-6 w-6" />
            Doubt Inbox
          </h1>
          {unreadCount > 0 && (
            <p className="text-sm text-destructive mt-1">{unreadCount} doubt{unreadCount !== 1 ? "s" : ""} need your response</p>
          )}
        </div>
        <Badge variant="outline" className="text-sm">{total} total</Badge>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {[
          { value: "", label: "All" },
          { value: "open", label: "Needs Response", icon: <Clock className="h-3 w-3" /> },
          { value: "ai_answered", label: "AI Answered", icon: <HelpCircle className="h-3 w-3" /> },
          { value: "creator_answered", label: "You Responded", icon: <MessageCircle className="h-3 w-3" /> },
          { value: "closed", label: "Resolved", icon: <CheckCircle className="h-3 w-3" /> },
        ].map(f => (
          <Button
            key={f.value}
            variant={filter === f.value ? "default" : "outline"}
            size="sm"
            className="gap-1 text-xs"
            onClick={() => { setFilter(f.value); setPage(1); }}
          >
            {f.icon}{f.label}
          </Button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
      ) : doubts.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 gap-4">
            <Inbox className="h-12 w-12 text-muted-foreground" />
            <p className="text-muted-foreground">{filter ? "No doubts matching this filter." : "No doubts in your inbox."}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {doubts.map((doubt) => (
            <Link key={doubt.id} href={`/dashboard/doubts/${doubt.id}`}>
              <Card className={`hover:border-primary/30 transition-colors cursor-pointer ${doubt.status === "open" ? "border-red-200 dark:border-red-800" : ""}`}>
                <CardContent className="flex items-start gap-3 py-3">
                  <Avatar className="h-8 w-8 shrink-0 mt-0.5">
                    <AvatarImage src={doubt.studentAvatar || undefined} />
                    <AvatarFallback className="text-xs">{doubt.studentName?.charAt(0) || "S"}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{doubt.studentName}</span>
                      <Badge variant={statusVariant(doubt.status)} className="text-[10px] py-0 h-5">
                        {statusLabel(doubt.status)}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground line-clamp-2 mt-0.5">{doubt.questionText}</p>
                    <p className="text-[10px] text-muted-foreground mt-1">{new Date(doubt.createdAt).toLocaleString()}</p>
                  </div>
                  {(doubt.status === "open") && (
                    <div className="shrink-0 mt-1">
                      <div className="h-2.5 w-2.5 rounded-full bg-red-500" />
                    </div>
                  )}
                </CardContent>
              </Card>
            </Link>
          ))}

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-4">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
              <span className="text-sm text-muted-foreground">Page {page} of {totalPages}</span>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next</Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
