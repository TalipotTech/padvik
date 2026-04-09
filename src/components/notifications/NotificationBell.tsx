"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NotificationCard } from "./NotificationCard";
import { useBoardSelection } from "@/hooks/use-board-selection";

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

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const { boardId } = useBoardSelection();
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Fetch unread count
  const fetchUnread = useCallback(() => {
    fetch("/api/notifications/unread-count")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.success) setUnreadCount(data.data.count);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchUnread();
    const interval = setInterval(fetchUnread, 5 * 60 * 1000); // 5 minutes
    return () => clearInterval(interval);
  }, [fetchUnread]);

  // Fetch notifications when dropdown opens
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    const params = new URLSearchParams({ limit: "10" });
    if (boardId) params.set("board", String(boardId));

    fetch(`/api/notifications?${params}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.success) setNotifications(data.data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open, boardId]);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  function markAllRead() {
    fetch("/api/notifications/mark-seen", { method: "POST" })
      .then(() => {
        setUnreadCount(0);
      })
      .catch(() => {});
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <Button
        variant="ghost"
        size="icon"
        className="relative"
        onClick={() => setOpen((p) => !p)}
        aria-label="Notifications"
      >
        <Bell className="size-5" />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </Button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-96 max-h-[70vh] overflow-y-auto rounded-lg border bg-card shadow-xl">
          <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-card px-4 py-3">
            <h3 className="font-semibold">Notifications</h3>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                className="text-xs text-violet-600 hover:underline"
              >
                Mark all as read
              </button>
            )}
          </div>

          <div className="space-y-2 p-3">
            {loading && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Loading...
              </p>
            )}
            {!loading && notifications.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No notifications yet
              </p>
            )}
            {!loading &&
              notifications.map((n) => (
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
          </div>

          <div className="sticky bottom-0 border-t bg-card p-3">
            <Link
              href="/dashboard/notifications"
              className="block text-center text-sm text-violet-600 hover:underline"
              onClick={() => setOpen(false)}
            >
              View all notifications
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
