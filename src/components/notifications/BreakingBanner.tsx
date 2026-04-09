"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, X } from "lucide-react";

interface BreakingNotification {
  id: number;
  title: string;
  slug: string | null;
  category: string;
  boardCode: string;
  boardName: string;
  publishedAt: string;
}

export function BreakingBanner() {
  const [notifications, setNotifications] = useState<BreakingNotification[]>([]);
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());

  useEffect(() => {
    // Load dismissed IDs from localStorage
    try {
      const stored = localStorage.getItem("padvik-dismissed-breaking");
      if (stored) setDismissed(new Set(JSON.parse(stored)));
    } catch {
      // ignore
    }

    fetch("/api/notifications/breaking")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.success && data.data?.length > 0) {
          setNotifications(data.data);
        }
      })
      .catch(() => {});
  }, []);

  const visible = notifications.filter((n) => !dismissed.has(n.id));
  if (visible.length === 0) return null;

  function dismiss(id: number) {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(id);
      localStorage.setItem(
        "padvik-dismissed-breaking",
        JSON.stringify([...next])
      );
      return next;
    });
  }

  return (
    <div className="relative z-50 bg-gradient-to-r from-red-600 to-amber-500 text-white">
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-2">
        <span className="relative flex size-2.5 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
          <span className="relative inline-flex size-2.5 rounded-full bg-white" />
        </span>
        <AlertTriangle className="size-4 shrink-0" />
        <div className="flex flex-1 items-center gap-4 overflow-x-auto scrollbar-none">
          {visible.map((n) => (
            <Link
              key={n.id}
              href={n.slug ? `/notifications/${n.slug}` : n.slug ?? "#"}
              className="whitespace-nowrap text-sm font-medium underline-offset-2 hover:underline"
            >
              <span className="font-bold">[{n.boardCode}]</span> {n.title}
            </Link>
          ))}
        </div>
        <button
          onClick={() => visible.forEach((n) => dismiss(n.id))}
          className="shrink-0 rounded-md p-1 hover:bg-white/20"
          aria-label="Dismiss"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}
