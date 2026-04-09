"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Loader2, Inbox } from "lucide-react";

interface Doubt {
  id: number;
  studentName: string;
  studentAvatar: string | null;
  questionText: string;
  status: string;
  createdAt: string;
}

const STATUS_COLORS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  open: "destructive",
  answered: "default",
  closed: "secondary",
};

export default function CreatorDoubtsPage() {
  const [doubts, setDoubts] = useState<Doubt[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    fetch(`/api/doubts/inbox?page=${page}&limit=20`)
      .then((r) => r.json())
      .then((res) => {
        if (res.success) {
          setDoubts(res.data.items);
          setTotalPages(res.data.pagination.totalPages);
        }
      })
      .finally(() => setLoading(false));
  }, [page]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Doubt Inbox</h1>

      {doubts.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 gap-4">
            <Inbox className="h-12 w-12 text-muted-foreground" />
            <p className="text-muted-foreground">No doubts in your inbox.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {doubts.map((doubt) => (
            <Link key={doubt.id} href={`/dashboard/doubts/${doubt.id}`}>
              <Card className="hover:border-primary/30 transition-colors cursor-pointer">
                <CardContent className="flex items-start gap-3 py-4">
                  <Avatar className="h-8 w-8 shrink-0 mt-0.5">
                    <AvatarImage src={doubt.studentAvatar || undefined} />
                    <AvatarFallback className="text-xs">
                      {doubt.studentName?.charAt(0) || "S"}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{doubt.studentName}</span>
                      <Badge variant={STATUS_COLORS[doubt.status] || "outline"} className="text-xs">
                        {doubt.status}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
                      {doubt.questionText}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {new Date(doubt.createdAt).toLocaleString()}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-4">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Previous
              </Button>
              <span className="text-sm text-muted-foreground">Page {page} of {totalPages}</span>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
                Next
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
