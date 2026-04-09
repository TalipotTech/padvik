"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bell, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NotificationCard } from "./NotificationCard";
import { useBoardSelection } from "@/hooks/use-board-selection";

interface Notification {
  id: number;
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
}

export function DashboardNotifications() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const { boardId } = useBoardSelection();

  useEffect(() => {
    const params = new URLSearchParams({ limit: "3" });
    if (boardId) params.set("board", String(boardId));

    fetch(`/api/notifications?${params}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.success) setNotifications(data.data);
      })
      .catch(() => {});
  }, [boardId]);

  if (notifications.length === 0) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Bell className="size-4 text-violet-500" />
          Your Board Updates
        </CardTitle>
        <Link
          href="/dashboard/notifications"
          className="inline-flex items-center text-xs text-violet-600 hover:underline"
        >
          View all
          <ChevronRight className="size-3" />
        </Link>
      </CardHeader>
      <CardContent className="space-y-2 pt-0">
        {notifications.map((n) => (
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
            showBoard={!boardId}
          />
        ))}
      </CardContent>
    </Card>
  );
}
