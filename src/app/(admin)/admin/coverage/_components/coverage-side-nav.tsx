"use client";

/**
 * Left-sidebar rendering of the admin shell's main menu, scoped to the
 * `/admin/coverage` route via `coverage/layout.tsx`. Mirrors the top-header
 * nav so the Coverage page — where admins spend most of their time — has
 * persistent, glanceable navigation on the left edge even while the page
 * content scrolls.
 *
 * Client-only so we can use `usePathname` for active-link highlighting;
 * the wrapping layout stays a Server Component for auth/redirect gating.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { primaryNav, legacyNav } from "../../../_nav";
import { cn } from "@/lib/utils";

export function CoverageSideNav() {
  const pathname = usePathname();

  // Match on startsWith so nested routes (e.g. /admin/coverage/subject/42)
  // keep the parent link highlighted. Fall back to exact match for root
  // paths like "/" that would otherwise match every link.
  const isActive = (href: string): boolean => {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(href + "/");
  };

  return (
    <nav className="flex flex-col gap-4 text-sm">
      <div>
        <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
          Main
        </div>
        <ul className="space-y-0.5">
          {primaryNav.map((item) => {
            const active = isActive(item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "block rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                    active
                      ? "bg-violet-600/10 text-violet-700 dark:text-violet-300"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>

      <div>
        <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
          Legacy
        </div>
        <ul className="space-y-0.5">
          {legacyNav.map((item) => {
            const active = isActive(item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  title="Legacy pipeline UI — prefer /admin/coverage"
                  className={cn(
                    "block rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                    active
                      ? "bg-violet-600/10 text-violet-700 dark:text-violet-300"
                      : "text-muted-foreground/70 hover:bg-muted hover:text-foreground"
                  )}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
