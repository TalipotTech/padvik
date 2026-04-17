"use client";

import { useEffect, useState } from "react";
import { HelpCircle } from "lucide-react";

/**
 * Doubt notification badge — polls for unread count every 30 seconds.
 * Shows a red badge with count on the doubt icon.
 */
export function DoubtBadge({ className }: { className?: string }) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    fetchCount();
    const interval = setInterval(fetchCount, 30000); // Poll every 30s
    return () => clearInterval(interval);
  }, []);

  async function fetchCount() {
    try {
      const res = await fetch("/api/doubts/unread-count");
      const data = await res.json();
      if (data.success) setCount(data.data.count);
    } catch { /* ignore */ }
  }

  return (
    <span className={`relative inline-flex ${className || ""}`}>
      <HelpCircle className="h-5 w-5" />
      {count > 0 && (
        <span className="absolute -top-1.5 -right-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </span>
  );
}
