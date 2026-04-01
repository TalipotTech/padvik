"use client";

import { useBoardSelection } from "@/hooks/use-board-selection";
import { Badge } from "@/components/ui/badge";
import { MobileSidebar } from "@/components/layout/sidebar";

interface HeaderProps {
  user: {
    name?: string | null;
    email?: string | null;
    image?: string | null;
    role?: string;
  };
  signOutAction: () => Promise<void>;
}

export function Header({ user, signOutAction }: HeaderProps) {
  const { boardName, grade } = useBoardSelection();

  return (
    <header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 px-4 lg:px-6">
      <MobileSidebar user={user} signOutAction={signOutAction} />

      <div className="flex flex-1 items-center gap-3">
        {/* Board/class badge — visible when user has selected one */}
        {boardName && (
          <Badge variant="secondary" className="hidden sm:inline-flex text-xs">
            {boardName} {grade ? `· Class ${grade}` : ""}
          </Badge>
        )}
      </div>

      {/* Right side — placeholder for notifications, search, etc. */}
      <div className="flex items-center gap-2">
        {/* Future: search, notifications */}
      </div>
    </header>
  );
}
