"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, HelpCircle, Plus } from "lucide-react";

interface Doubt {
  id: number;
  questionText: string;
  status: string;
  upvoteCount: number;
  createdAt: string;
}

const STATUS_COLORS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  open: "destructive",
  answered: "default",
  closed: "secondary",
};

export default function StudentDoubtsPage() {
  const [doubts, setDoubts] = useState<Doubt[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    fetch(`/api/doubts?mine=true&page=${page}&limit=20`)
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
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">My Doubts</h1>
        <Link href="/dashboard/doubts/ask">
          <Button className="gap-2">
            <Plus className="h-4 w-4" />
            Ask a Doubt
          </Button>
        </Link>
      </div>

      {doubts.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 gap-4">
            <HelpCircle className="h-12 w-12 text-muted-foreground" />
            <p className="text-muted-foreground">No doubts yet. Ask your first question!</p>
            <Link href="/dashboard/doubts/ask">
              <Button variant="outline" className="gap-2">
                <Plus className="h-4 w-4" />
                Ask a Doubt
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {doubts.map((doubt) => (
            <Link key={doubt.id} href={`/dashboard/doubts/${doubt.id}`}>
              <Card className="hover:border-primary/30 transition-colors cursor-pointer">
                <CardContent className="py-4">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant={STATUS_COLORS[doubt.status] || "outline"} className="text-xs">
                      {doubt.status}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {new Date(doubt.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  <p className="text-sm line-clamp-2">{doubt.questionText}</p>
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
