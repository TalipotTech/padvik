"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { NotificationCard } from "./NotificationCard";
import { ChevronRight } from "lucide-react";

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
}

export function BoardUpdatesFeed() {
  const [notifications, setNotifications] = useState<Notification[]>([]);

  useEffect(() => {
    fetch("/api/notifications?limit=8")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.success && data.data?.length > 0) {
          setNotifications(data.data);
        }
      })
      .catch(() => {});
  }, []);

  if (notifications.length === 0) return null;

  return (
    <section className="border-t bg-muted/10">
      <div className="mx-auto max-w-7xl px-4 py-16">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight">
            Latest Board Updates
          </h2>
          <p className="mt-3 text-muted-foreground">
            Exam dates, results, circulars and more from official board websites
          </p>
        </div>
        <div className="mt-10 grid gap-4 sm:grid-cols-2">
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
              boardName={n.boardName}
              showBoard
            />
          ))}
        </div>
        <div className="mt-8 text-center">
          <Link
            href="/notifications"
            className="inline-flex items-center gap-1 text-sm font-medium text-violet-600 hover:underline"
          >
            View all updates
            <ChevronRight className="size-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}
