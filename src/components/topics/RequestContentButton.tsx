"use client";

/**
 * RequestContentButton — lets a student ask Padvik to create study material
 * for a topic that has no content yet. Posts a 'direct_request' demand signal
 * via /api/topics/{topicId}/request-content.
 *
 * After a successful request (or if requested within the last 24h), the button
 * is disabled and shows a confirmation. The 24h lock is tracked in localStorage
 * so it survives reloads without a server round-trip.
 *
 * Place this on topic pages where no Padvik content exists.
 */
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

const DAY_MS = 24 * 60 * 60 * 1000;

function storageKey(topicId: number | string): string {
  return `padvik:request-content:${topicId}`;
}

export interface RequestContentButtonProps {
  topicId: number;
  className?: string;
}

export function RequestContentButton({ topicId, className }: RequestContentButtonProps) {
  const [requested, setRequested] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // On mount, check whether this topic was requested within the last 24h.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey(topicId));
      if (raw && Date.now() - Number(raw) < DAY_MS) {
        setRequested(true);
      }
    } catch {
      /* localStorage unavailable — ignore */
    }
  }, [topicId]);

  async function handleClick() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/topics/${topicId}/request-content`, { method: "POST" });
      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.success) {
        setError(json?.error?.message ?? "Could not submit your request. Please try again.");
        return;
      }

      try {
        localStorage.setItem(storageKey(topicId), String(Date.now()));
      } catch {
        /* ignore */
      }
      setRequested(true);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (requested) {
    return (
      <p className={className} role="status">
        ✅ Noted! We&apos;ll create content based on demand.
      </p>
    );
  }

  return (
    <div className={className}>
      <Button onClick={handleClick} disabled={loading} variant="outline">
        {loading ? "Submitting…" : "📚 Request study material for this topic"}
      </Button>
      {error && (
        <p className="mt-2 text-sm text-red-500" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export default RequestContentButton;
