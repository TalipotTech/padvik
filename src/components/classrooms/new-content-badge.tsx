"use client";

import { useState, useEffect, useCallback } from "react";
import { BookOpen } from "lucide-react";

const POLL_INTERVAL = 60_000; // 60 seconds
const STORAGE_KEY = "padvik-classroom-last-seen";

function getLastSeen(): string {
  if (typeof window === "undefined") return new Date().toISOString();
  return localStorage.getItem(STORAGE_KEY) || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
}

/** Mark classrooms as seen — call this when student visits the classrooms page */
export function markClassroomsSeen() {
  if (typeof window !== "undefined") {
    localStorage.setItem(STORAGE_KEY, new Date().toISOString());
  }
}

interface NewContentBadgeProps {
  /** "icon" = full icon with badge (header), "dot" = small indicator dot (sidebar) */
  variant?: "icon" | "dot";
  className?: string;
}

/**
 * Polls for new classroom content and shows a badge/dot.
 * Uses localStorage for last-seen tracking (MVP).
 */
export function NewContentBadge({ variant = "icon", className }: NewContentBadgeProps) {
  const [count, setCount] = useState(0);

  const fetchCount = useCallback(async () => {
    try {
      const since = getLastSeen();
      const res = await fetch(`/api/my/new-content-count?since=${encodeURIComponent(since)}`);
      const data = await res.json();
      if (data.success) setCount(data.data.count);
    } catch {
      // Silently fail
    }
  }, []);

  useEffect(() => {
    fetchCount();
    const interval = setInterval(fetchCount, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchCount]);

  if (count === 0) {
    if (variant === "dot") return null;
    return (
      <div className={className}>
        <BookOpen className="h-5 w-5 text-muted-foreground" />
      </div>
    );
  }

  if (variant === "dot") {
    return (
      <span className={`inline-block h-2 w-2 rounded-full bg-violet-500 ${className ?? ""}`} />
    );
  }

  // Icon variant with badge
  return (
    <div className={`relative ${className ?? ""}`}>
      <BookOpen className="h-5 w-5 text-muted-foreground" />
      <span className="absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-violet-600 px-1 text-[10px] font-bold text-white">
        {count > 99 ? "99+" : count}
      </span>
    </div>
  );
}
