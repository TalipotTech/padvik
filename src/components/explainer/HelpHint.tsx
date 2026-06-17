"use client";

import { HelpCircle } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * A small "?" help affordance used next to action buttons.
 *  - hover  → native tooltip with a one-line summary
 *  - click  → popover with a title + a fuller "what it does / how to use it"
 *
 * Kept deliberately simple (native title for hover, Radix Popover for the
 * click popup) so there's no fragile Tooltip-inside-Popover nesting.
 */
export function HelpHint({
  title,
  summary,
  children,
  className,
}: {
  title: string;
  /** Short one-liner shown as the hover tooltip. */
  summary: string;
  /** Rich explanation shown in the popover. */
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={summary}
          aria-label={`Help: ${title}`}
          className={cn(
            "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500",
            className,
          )}
        >
          <HelpCircle className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 text-sm">
        <p className="mb-1.5 font-semibold text-foreground">{title}</p>
        <div className="space-y-1.5 text-xs leading-relaxed text-muted-foreground">
          {children}
        </div>
      </PopoverContent>
    </Popover>
  );
}
