"use client";

import { useBoardSelection } from "@/hooks/use-board-selection";
import { Badge } from "@/components/ui/badge";
import { MobileSidebar } from "@/components/layout/sidebar";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { Sparkles } from "lucide-react";

interface HeaderProps {
  user: {
    name?: string | null;
    email?: string | null;
    image?: string | null;
    role?: string;
    isCreator?: boolean;
    creatorDisplayName?: string | null;
  };
  signOutAction: () => Promise<void>;
}

export function Header({ user, signOutAction }: HeaderProps) {
  const { boardName, grade } = useBoardSelection();

  return (
    <header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 px-4 lg:px-6">
      <MobileSidebar user={user} signOutAction={signOutAction} />

      <div className="flex flex-1 items-center gap-3">
        {user.isCreator ? (
          /* Creator header — show creator name + badge */
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium truncate max-w-[200px]">
              {user.creatorDisplayName || user.name || "Creator"}
            </span>
            <Badge variant="secondary" className="text-xs">Creator</Badge>
          </div>
        ) : (
          /* Standard header — show board/class badge */
          boardName && (
            <Badge variant="secondary" className="hidden sm:inline-flex text-xs">
              {boardName} {grade ? `· Class ${grade}` : ""}
            </Badge>
          )
        )}
      </div>

      {/* Right side */}
      <div className="flex items-center gap-2">
        <NotificationBell />
      </div>
    </header>
  );
}
