/**
 * Shared admin nav definitions.
 *
 * Single source of truth for the admin shell's primary + legacy nav links.
 * Consumed by the top header in `(admin)/layout.tsx` and by the left-sidebar
 * layout under `(admin)/admin/coverage/layout.tsx`. Keeping one list prevents
 * silent drift between the two menus.
 */

export interface AdminNavItem {
  href: string;
  label: string;
}

// Primary nav — the simplified, end-to-end workflow that admins should use
// every day. "Coverage" is the one-point Board→Grade→Subject content view
// with a three-step ingest pipeline (bootstrap → fan-out → auto-publish).
export const primaryNav: AdminNavItem[] = [
  { href: "/admin/coverage", label: "Coverage" },
  { href: "/curriculum", label: "Syllabus" },
  { href: "/question-papers", label: "Questions" },
  { href: "/admin/ai-providers", label: "AI Providers" },
  { href: "/admin/notification-scraper", label: "Notifications" },
];

// Legacy nav — older pipeline UIs kept around for visibility and audit, but
// the simplified Coverage flow above is now the preferred entry point.
// These stay one click away; the visual separator makes the distinction clear.
export const legacyNav: AdminNavItem[] = [
  { href: "/scrape-jobs", label: "Scrape Jobs" },
  { href: "/admin/pipeline", label: "Pipeline Overview" },
  { href: "/admin/content-review", label: "Review" },
];

// Help nav — guides shown under the header "Help" dropdown. Add new guides
// here and they appear in the menu automatically.
export interface AdminHelpItem extends AdminNavItem {
  description?: string;
}

export const helpNav: AdminHelpItem[] = [
  { href: "/help", label: "Help Home", description: "All admin guides in one place." },
  {
    href: "/help/auto-content",
    label: "Auto-Content Pipeline",
    description: "How AI study material is requested, generated, reviewed & billed.",
  },
];
