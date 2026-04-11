"use client";

import { useEffect } from "react";
import { ensureUserSelection } from "@/hooks/use-board-selection";

/**
 * Client component that syncs the board selection with the current user session.
 * Clears stale localStorage data from previous users on sign-in change.
 */
export function UserSessionSync({ userId, isCreator }: { userId: string | number; isCreator?: boolean }) {
  useEffect(() => {
    ensureUserSelection(userId);
    // Store role for breadcrumb context detection
    if (typeof window !== "undefined") {
      localStorage.setItem("padvik-last-role", isCreator ? "creator" : "student");
    }
  }, [userId, isCreator]);

  return null;
}
