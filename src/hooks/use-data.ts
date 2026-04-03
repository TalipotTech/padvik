"use client";

import { useState, useEffect, useRef, useCallback } from "react";

/**
 * Generic data-fetching hook for client components.
 * Skips fetch when any dep is null/undefined.
 */
export function useData<T>(
  fetcher: () => Promise<T>,
  deps: unknown[],
): { data: T | null; loading: boolean; error: string | null; refetch: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const versionRef = useRef(0);

  const doFetch = useCallback(() => {
    // Skip if any dependency is null/undefined
    const hasNullDep = deps.some((d) => d === null || d === undefined);
    if (hasNullDep) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }

    const version = ++versionRef.current;
    setLoading(true);
    setError(null);

    fetcher()
      .then((result) => {
        if (version === versionRef.current) {
          setData(result);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (version === versionRef.current) {
          setError(err instanceof Error ? err.message : "An error occurred");
          setLoading(false);
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    doFetch();
  }, [doFetch]);

  return { data, loading, error, refetch: doFetch };
}
