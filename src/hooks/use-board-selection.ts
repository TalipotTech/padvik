"use client";

import { useCallback, useEffect, useState } from "react";

const CACHE_KEY = "padvik-board-cache";
const USER_KEY = "padvik-board-user";

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

// Global in-memory state (shared across all hook instances in the same page)
let _currentSelection: BoardSelection = defaultSelection;
let _loaded = false;
const _listeners = new Set<() => void>();

function emit() {
  for (const fn of _listeners) fn();
}

/**
 * Clear the board cache when a different user signs in.
 * Called from UserSessionSync component on every dashboard render.
 */
export function ensureUserSelection(userId: string | number) {
  if (typeof window === "undefined") return;
  const storedUser = localStorage.getItem(USER_KEY);
  const current = String(userId);

  if (storedUser !== current) {
    // Different user — wipe cache and force re-fetch from DB
    localStorage.removeItem(CACHE_KEY);
    localStorage.setItem(USER_KEY, current);
    _currentSelection = defaultSelection;
    _loaded = false;
    emit();
  }
}

/** Reset on sign-out */
export function resetBoardHydration() {
  _currentSelection = defaultSelection;
  _loaded = false;
  if (typeof window !== "undefined") {
    localStorage.removeItem(CACHE_KEY);
    localStorage.removeItem(USER_KEY);
  }
  emit();
}

export function useBoardSelection() {
  const [, setTick] = useState(0);

  // Subscribe to global changes
  useEffect(() => {
    const listener = () => setTick(t => t + 1);
    _listeners.add(listener);
    return () => { _listeners.delete(listener); };
  }, []);

  // Fetch from server on first mount (if not already loaded)
  useEffect(() => {
    if (_loaded) return;
    _loaded = true;

    // Check local cache first (same user, same session — fast path)
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached) as BoardSelection;
        if (parsed.boardId) {
          _currentSelection = parsed;
          emit();
          return; // Cache hit — skip API call
        }
      }
    } catch { /* ignore */ }

    // Fetch from DB via profile API — the source of truth
    fetch("/api/user/profile")
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data?.success) return;
        const { boardId, boardCode, boardName, grade } = data.data;
        if (boardId) {
          _currentSelection = {
            boardId,
            boardName: boardCode ?? boardName ?? null,
            grade: grade ?? null,
            stream: null,
          };
          // Cache for this session
          localStorage.setItem(CACHE_KEY, JSON.stringify(_currentSelection));
        } else {
          _currentSelection = defaultSelection;
        }
        emit();
      })
      .catch(() => { /* non-critical */ });
  }, []);

  const setSelection = useCallback((sel: Partial<BoardSelection>) => {
    _currentSelection = { ..._currentSelection, ...sel };
    // Cache locally
    localStorage.setItem(CACHE_KEY, JSON.stringify(_currentSelection));
    emit();
  }, []);

  const clearSelection = useCallback(() => {
    _currentSelection = defaultSelection;
    localStorage.removeItem(CACHE_KEY);
    emit();
  }, []);

  return {
    ..._currentSelection,
    setSelection,
    clearSelection,
  };
}
