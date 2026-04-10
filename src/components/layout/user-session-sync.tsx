"use client";

import { useEffect } from "react";
import { ensureUserSelection } from "@/hooks/use-board-selection";

/**
 * Client component that syncs the board selection with the current user session.
 * Clears stale localStorage data from previous users on sign-in change.
 */
export function UserSessionSync({ userId }: { userId: string | number }) {
  useEffect(() => {
    ensureUserSelection(userId);
  }, [userId]);

  return null; // Invisible component — only runs the effect
}
