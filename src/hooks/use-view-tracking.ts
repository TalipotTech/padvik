"use client";

import { useEffect, useRef, useCallback } from "react";

/**
 * Hook for tracking content views with periodic heartbeat.
 *
 * Usage:
 *   const { onPlay, onPause, onTimeUpdate, onEnded } = useViewTracking(contentId, classroomId);
 *   <video onPlay={onPlay} onPause={onPause} onTimeUpdate={onTimeUpdate} onEnded={onEnded} />
 *
 * For non-video content, just mount the hook — it sends an initial view on mount.
 */
export function useViewTracking(contentId: number, classroomId?: number) {
  const watchedRef = useRef(0);
  const playingRef = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sentInitial = useRef(false);

  // Send view update to API
  const sendUpdate = useCallback((completed = false) => {
    fetch(`/api/content/${contentId}/view`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        watchedSeconds: Math.round(watchedRef.current),
        classroomId: classroomId || null,
        completed,
      }),
    }).catch(() => {});
  }, [contentId, classroomId]);

  // Send initial view on mount (for all content types)
  useEffect(() => {
    if (!sentInitial.current) {
      sentInitial.current = true;
      sendUpdate(false);
    }

    // Cleanup: send final update when leaving page
    return () => {
      if (watchedRef.current > 0) {
        // Use sendBeacon for reliable send on page unload
        const data = JSON.stringify({
          watchedSeconds: Math.round(watchedRef.current),
          classroomId: classroomId || null,
        });
        try {
          navigator.sendBeacon(`/api/content/${contentId}/view`, new Blob([data], { type: "application/json" }));
        } catch {
          // Fallback
          sendUpdate();
        }
      }
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [contentId, classroomId, sendUpdate]);

  // Start heartbeat when playing
  const startHeartbeat = useCallback(() => {
    if (intervalRef.current) return;
    intervalRef.current = setInterval(() => {
      if (playingRef.current) {
        sendUpdate(false);
      }
    }, 30000); // Every 30 seconds
  }, [sendUpdate]);

  const stopHeartbeat = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const onPlay = useCallback(() => {
    playingRef.current = true;
    startHeartbeat();
  }, [startHeartbeat]);

  const onPause = useCallback(() => {
    playingRef.current = false;
    sendUpdate(false);
    stopHeartbeat();
  }, [sendUpdate, stopHeartbeat]);

  const onTimeUpdate = useCallback((e: React.SyntheticEvent<HTMLVideoElement | HTMLAudioElement>) => {
    watchedRef.current = (e.target as HTMLVideoElement).currentTime;
  }, []);

  const onEnded = useCallback(() => {
    playingRef.current = false;
    sendUpdate(true); // completed
    stopHeartbeat();
  }, [sendUpdate, stopHeartbeat]);

  return { onPlay, onPause, onTimeUpdate, onEnded };
}
