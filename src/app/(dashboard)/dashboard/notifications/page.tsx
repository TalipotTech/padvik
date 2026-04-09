"use client";

import { useEffect, useState, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { NotificationCard } from "@/components/notifications/NotificationCard";
import { useBoardSelection } from "@/hooks/use-board-selection";
import { Search, Loader2, Bell } from "lucide-react";

const CATEGORIES = [
  { value: "all", label: "All" },
  { value: "exam_date", label: "Exams" },
  { value: "result", label: "Results" },
  { value: "admit_card", label: "Admit Cards" },
  { value: "circular", label: "Circulars" },
  { value: "syllabus", label: "Syllabus" },
  { value: "general", label: "General" },
];

interface Notification {
  id: number;
  boardId: number;
  boardCode: string;
  boardName: string;
  title: string;
  slug: string | null;
  category: string;
  summary: string | null;
  sourceUrl: string;
  pdfUrl: string | null;
  priority: string;
  isBreaking: boolean;
  publishedAt: string;
  affectedClasses: number[];
}

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [total, setTotal] = useState(0);
  const offsetRef = useRef(0);
  const { boardId, grade } = useBoardSelection();
  const limit = 20;

  async function fetchNotifications(reset: boolean) {
    const currentOffset = reset ? 0 : offsetRef.current;
    if (reset) {
      setLoading(true);
      offsetRef.current = 0;
    } else {
      setLoadingMore(true);
    }

    const params = new URLSearchParams({ limit: String(limit), offset: String(currentOffset) });
    if (boardId) params.set("board", String(boardId));
    if (category !== "all") params.set("category", category);
    // Don't filter by class — show all notifications for the board

    try {
      const res = await fetch(`/api/notifications?${params}`);
      const data = await res.json();
      if (data?.success) {
        if (reset) {
          setNotifications(data.data);
        } else {
          setNotifications((prev) => [...prev, ...data.data]);
        }
        setTotal(data.pagination.total);
        offsetRef.current = currentOffset + data.data.length;
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    fetchNotifications(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId, category]);

  // Filter by search client-side
  const filtered = search
    ? notifications.filter(
        (n) =>
          n.title.toLowerCase().includes(search.toLowerCase()) ||
          (n.summary ?? "").toLowerCase().includes(search.toLowerCase())
      )
    : notifications;

  const hasMore = notifications.length < total;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Bell className="size-6 text-violet-500" />
          Board Notifications
        </h1>
        <p className="text-sm text-muted-foreground">
          Latest updates from {boardId ? "your education board" : "all education boards"}
        </p>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search notifications..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      <Tabs value={category} onValueChange={setCategory}>
        <TabsList className="flex-wrap">
          {CATEGORIES.map((c) => (
            <TabsTrigger key={c.value} value={c.value} className="text-xs">
              {c.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {loading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="size-6 animate-spin text-violet-500" />
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <Bell className="size-10 text-muted-foreground/40" />
          <div>
            <p className="font-medium">No notifications found</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {boardId
                ? "No notifications for your board yet. Check back later."
                : "Select a board from the dashboard to see relevant notifications."}
            </p>
          </div>
        </div>
      )}

      {!loading && (
        <div className="space-y-3">
          {filtered.map((n) => (
            <NotificationCard
              key={n.id}
              id={n.id}
              title={n.title}
              slug={n.slug}
              category={n.category}
              summary={n.summary}
              sourceUrl={n.sourceUrl}
              pdfUrl={n.pdfUrl}
              priority={n.priority}
              isBreaking={n.isBreaking}
              publishedAt={n.publishedAt}
              boardCode={n.boardCode}
              boardName={n.boardName}
              showBoard={!boardId}
            />
          ))}
        </div>
      )}

      {hasMore && !loading && (
        <div className="text-center">
          <Button
            variant="outline"
            onClick={() => fetchNotifications(false)}
            disabled={loadingMore}
          >
            {loadingMore ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : null}
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}
