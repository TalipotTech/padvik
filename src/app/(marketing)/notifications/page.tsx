import Link from "next/link";
import type { Metadata } from "next";
import { db } from "@/db";
import { boardNotifications } from "@/db/schema/notifications";
import { boards } from "@/db/schema/curriculum";
import { eq, desc, and, sql, type SQL } from "drizzle-orm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronRight, FileDown, ExternalLink } from "lucide-react";
import { NotificationCard } from "@/components/notifications/NotificationCard";
import { PadvikLogo } from "@/components/ui/padvik-logo";

export const metadata: Metadata = {
  title: "Board Notifications | Padvik",
  description:
    "Latest exam dates, results, circulars and updates from CBSE, ICSE, Kerala, Karnataka and other Indian education boards.",
};

const CATEGORY_LABELS: Record<string, string> = {
  exam_date: "Exam Date",
  result: "Result",
  admit_card: "Admit Card",
  circular: "Circular",
  syllabus: "Syllabus",
  policy: "Policy",
  general: "General",
};

interface PageProps {
  searchParams: Promise<{
    board?: string;
    category?: string;
    page?: string;
    /** Academic year filter, "YYYY-YY" (e.g. "2025-26"). Read from metadata->>'academicYear'. */
    year?: string;
  }>;
}

// Tight format check — rejects "2025", "garbage", or SQL injection attempts.
// The scraper only ever writes YYYY-YY to metadata, so a match-all-else is fine.
const YEAR_RE = /^\d{4}-\d{2}$/;

export default async function PublicNotificationsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const boardFilter = params.board;
  const categoryFilter = params.category;
  const yearFilter = params.year && YEAR_RE.test(params.year) ? params.year : undefined;
  const page = Math.max(1, Number(params.page ?? 1));
  const limit = 20;
  const offset = (page - 1) * limit;

  // Build a preserve-filters href helper — used by every chip + pagination
  // link so switching one dimension (year, board, category) doesn't blow
  // away the others. Returns `/notifications` when all cleared.
  const buildHref = (overrides: Record<string, string | undefined>): string => {
    const merged: Record<string, string | undefined> = {
      board: boardFilter,
      category: categoryFilter,
      year: yearFilter,
      ...overrides,
    };
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(merged)) {
      if (v) qs.set(k, v);
    }
    const s = qs.toString();
    return s ? `/notifications?${s}` : "/notifications";
  };

  const conditions: SQL[] = [];
  if (boardFilter) {
    const board = await db
      .select({ id: boards.id })
      .from(boards)
      .where(eq(boards.code, boardFilter))
      .limit(1);
    if (board[0]) {
      conditions.push(eq(boardNotifications.boardId, board[0].id));
    }
  }
  if (categoryFilter && categoryFilter in CATEGORY_LABELS) {
    conditions.push(eq(boardNotifications.category, categoryFilter));
  }
  if (yearFilter) {
    // Year lives in metadata JSONB — `->>` returns the text value, which
    // we compare as text. Using raw SQL here because Drizzle doesn't have
    // a first-class jsonb-path helper for ->> comparisons.
    conditions.push(sql`${boardNotifications.metadata}->>'academicYear' = ${yearFilter}`);
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const notifications = await db
    .select({
      id: boardNotifications.id,
      boardCode: boards.code,
      boardName: boards.name,
      title: boardNotifications.title,
      slug: boardNotifications.slug,
      category: boardNotifications.category,
      summary: boardNotifications.summary,
      sourceUrl: boardNotifications.sourceUrl,
      pdfUrl: boardNotifications.pdfUrl,
      priority: boardNotifications.priority,
      isBreaking: boardNotifications.isBreaking,
      publishedAt: boardNotifications.publishedAt,
    })
    .from(boardNotifications)
    .innerJoin(boards, eq(boardNotifications.boardId, boards.id))
    .where(where)
    .orderBy(desc(boardNotifications.publishedAt))
    .limit(limit)
    .offset(offset);

  // Get boards that have notifications
  const availableBoards = await db
    .select({ code: boards.code, name: boards.name })
    .from(boards)
    .where(
      sql`${boards.id} IN (SELECT DISTINCT board_id FROM board_notifications)`
    )
    .orderBy(boards.name);

  // Distinct academic years across notifications. Sorted descending so the
  // most recent session appears first — matches how people think about the
  // current academic year. Rows without an academicYear (general circulars,
  // pre-migration data) simply don't surface here, which is fine: the
  // admin's implicit filter is "only show year-bound notifications".
  const availableYearsRaw = await db.execute<{ academic_year: string }>(sql`
    SELECT DISTINCT metadata->>'academicYear' AS academic_year
    FROM board_notifications
    WHERE metadata ? 'academicYear'
    ORDER BY metadata->>'academicYear' DESC
  `);
  const availableYearsRows = Array.isArray(availableYearsRaw)
    ? (availableYearsRaw as { academic_year: string }[])
    : (availableYearsRaw as { rows?: { academic_year: string }[] }).rows ?? [];
  const availableYears = availableYearsRows
    .map((r) => r.academic_year)
    .filter((y): y is string => !!y);

  const categories = Object.entries(CATEGORY_LABELS);

  return (
    <div className="min-h-screen bg-background">
      {/* Navbar */}
      <nav className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4">
          <Link href="/">
            <PadvikLogo size="lg" />
          </Link>
          <Link href="/login">
            <Button size="sm">Sign In</Button>
          </Link>
        </div>
      </nav>

      <main className="mx-auto max-w-5xl px-4 py-10">
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight">Board Notifications</h1>
          <p className="mt-2 text-muted-foreground">
            Latest updates from Indian education boards
          </p>
        </div>

        {/* Filters — board / category / year. Each chip preserves the
            other two dimensions via buildHref so the admin never loses
            their place when they click a new filter. The "All" chip
            clears every filter at once. */}
        <div className="mt-8 flex flex-wrap items-center gap-2">
          <Link href="/notifications">
            <Badge
              variant={!boardFilter && !categoryFilter && !yearFilter ? "default" : "outline"}
              className="cursor-pointer"
            >
              All
            </Badge>
          </Link>
          {availableBoards.map((b) => (
            <Link key={b.code} href={buildHref({ board: b.code, page: undefined })}>
              <Badge
                variant={boardFilter === b.code ? "default" : "outline"}
                className="cursor-pointer"
              >
                {b.code}
              </Badge>
            </Link>
          ))}
          <span className="mx-2 text-muted-foreground">|</span>
          {categories.map(([value, label]) => (
            <Link key={value} href={buildHref({ category: value, page: undefined })}>
              <Badge
                variant={categoryFilter === value ? "default" : "outline"}
                className="cursor-pointer text-xs"
              >
                {label}
              </Badge>
            </Link>
          ))}
          {availableYears.length > 0 && (
            <>
              <span className="mx-2 text-muted-foreground">|</span>
              {/* Year chip — clears itself when the active year is re-clicked,
                  which is why we short-circuit to `undefined` instead of the
                  same value. Without this the active chip would be a dead end. */}
              {availableYears.map((y) => (
                <Link
                  key={y}
                  href={buildHref({
                    year: yearFilter === y ? undefined : y,
                    page: undefined,
                  })}
                >
                  <Badge
                    variant={yearFilter === y ? "default" : "outline"}
                    className="cursor-pointer text-xs"
                  >
                    {y}
                  </Badge>
                </Link>
              ))}
            </>
          )}
        </div>

        {/* Notification list */}
        <div className="mt-8 space-y-3">
          {notifications.length === 0 && (
            <p className="py-16 text-center text-muted-foreground">
              No notifications found
            </p>
          )}
          {notifications.map((n) => (
            <NotificationCard
              key={n.id}
              id={n.id}
              title={n.title}
              slug={n.slug}
              category={n.category}
              summary={n.summary}
              sourceUrl={n.sourceUrl}
              pdfUrl={n.pdfUrl}
              priority={n.priority}
              isBreaking={n.isBreaking}
              publishedAt={n.publishedAt}
              boardCode={n.boardCode}
              boardName={n.boardName}
              showBoard
            />
          ))}
        </div>

        {/* Pagination — carries every active filter including year via buildHref. */}
        {notifications.length === limit && (
          <div className="mt-8 flex justify-center gap-2">
            {page > 1 && (
              <Link href={buildHref({ page: String(page - 1) })}>
                <Button variant="outline" size="sm">Previous</Button>
              </Link>
            )}
            <Link href={buildHref({ page: String(page + 1) })}>
              <Button variant="outline" size="sm">
                Next
                <ChevronRight className="ml-1 size-4" />
              </Button>
            </Link>
          </div>
        )}

        {/* CTA */}
        <section className="mt-16 rounded-xl border bg-violet-50/50 p-8 text-center dark:bg-violet-950/20">
          <h3 className="text-xl font-bold">Get personalized board updates</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Sign up to get notifications scoped to your board and class.
          </p>
          <Link href="/login" className="mt-4 inline-block">
            <Button>
              Sign up free
              <ChevronRight className="ml-1 size-4" />
            </Button>
          </Link>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t bg-muted/30 mt-16">
        <div className="mx-auto max-w-5xl px-4 py-8">
          <div className="flex items-center justify-between">
            <PadvikLogo size="sm" />
            <p className="text-xs text-muted-foreground">
              &copy; {new Date().getFullYear()} Ensate Technologies
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
