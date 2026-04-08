"use client";

import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "padvik-board-selection";

export interface BoardSelection {
  boardId: number | null;
  boardName: string | null;
  grade: number | null;
  stream: string | null;
}

const defaultSelection: BoardSelection = {
  boardId: null,
  boardName: null,
  grade: null,
  stream: null,
};

// Cached snapshot — useSyncExternalStore requires referential stability
let cachedSelection: BoardSelection = defaultSelection;
let cachedRaw: string | null = null;

function getSnapshot(): BoardSelection {
  if (typeof window === "undefined") return defaultSelection;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw !== cachedRaw) {
      cachedRaw = raw;
      cachedSelection = raw ? (JSON.parse(raw) as BoardSelection) : defaultSelection;
    }
    return cachedSelection;
  } catch {
    return defaultSelection;
  }
}

function getServerSnapshot(): BoardSelection {
  return defaultSelection;
}

// Subscribers for useSyncExternalStore
const listeners = new Set<() => void>();
function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function emitChange() {
  for (const listener of listeners) listener();
}

// Hydrate from profile API if localStorage is empty (one-time)
let hydrated = false;
function hydrateFromProfile() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;

  // Only hydrate if localStorage has no selection
  const existing = localStorage.getItem(STORAGE_KEY);
  if (existing) return;

  fetch("/api/user/profile")
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      if (!data?.success || !data.data?.boardId) return;
      const { boardId, boardName, boardCode, grade } = data.data;
      const sel: BoardSelection = {
        boardId,
        boardName: boardCode ?? boardName ?? null,
        grade: grade ?? null,
        stream: null,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sel));
      emitChange();
    })
    .catch(() => { /* non-critical */ });
}

export function useBoardSelection() {
  const selection = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // Hydrate from DB on first render if localStorage is empty
  if (typeof window !== "undefined") hydrateFromProfile();

  const setSelection = useCallback((sel: Partial<BoardSelection>) => {
    const current = getSnapshot();
    const next = { ...current, ...sel };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    emitChange();
  }, []);

  const clearSelection = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    emitChange();
  }, []);

  return {
    ...selection,
    setSelection,
    clearSelection,
  };
}
