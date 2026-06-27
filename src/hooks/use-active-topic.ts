"use client";

import { useEffect, useState } from "react";

/**
 * Shared "active topic" store — module-level pub/sub (same pattern as
 * use-board-selection). A page that is showing a specific topic (the search
 * results page, the Playground, …) publishes it here; the global floating chat
 * widget reads it so the assistant becomes context-sensitive to whatever the
 * student is currently looking at — without coupling the widget to any page.
 */

export interface ActiveTopic {
  topicId: number;
  title: string;
  subject: string | null;
  boardCode: string | null;
  grade: number | null;
}

let _active: ActiveTopic | null = null;
const _listeners = new Set<() => void>();

function emit() {
  for (const fn of _listeners) fn();
}

/** Publish the topic the student is currently viewing. */
export function setActiveTopic(topic: ActiveTopic | null) {
  const sameId = (topic?.topicId ?? null) === (_active?.topicId ?? null);
  // No-op if nothing changed (avoids re-render churn).
  if (sameId && !!topic === !!_active) return;
  _active = topic;
  emit();
}

/** Clear the active topic (e.g. when leaving a topic page). */
export function clearActiveTopic() {
  if (_active !== null) {
    _active = null;
    emit();
  }
}

/** Subscribe to the active topic. Returns null when nothing is active. */
export function useActiveTopic(): ActiveTopic | null {
  const [, setTick] = useState(0);
  useEffect(() => {
    const listener = () => setTick((t) => t + 1);
    _listeners.add(listener);
    return () => {
      _listeners.delete(listener);
    };
  }, []);
  return _active;
}
