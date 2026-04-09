import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileDown, ExternalLink, ArrowLeft, ChevronRight } from "lucide-react";
import { PadvikLogo } from "@/components/ui/padvik-logo";
import { db } from "@/db";
import { boardNotifications } from "@/db/schema/notifications";
import { boards } from "@/db/schema/curriculum";
import { eq, desc, and, ne } from "drizzle-orm";

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
  params: Promise<{ slug: string }>;
}

async function getNotification(slug: string) {
  const result = await db
    .select({
      id: boardNotifications.id,
      boardId: boardNotifications.boardId,
      boardCode: boards.code,
      boardName: boards.name,
      title: boardNotifications.title,
      slug: boardNotifications.slug,
      category: boardNotifications.category,
      summary: boardNotifications.summary,
      sourceUrl: boardNotifications.sourceUrl,
      pdfUrl: boardNotifications.pdfUrl,
      affectedClasses: boardNotifications.affectedClasses,
      priority: boardNotifications.priority,
      isBreaking: boardNotifications.isBreaking,
      publishedAt: boardNotifications.publishedAt,
      createdAt: boardNotifications.createdAt,
    })
    .from(boardNotifications)
    .innerJoin(boards, eq(boardNotifications.boardId, boards.id))
    .where(eq(boardNotifications.slug, slug))
    .limit(1);

  return result[0] ?? null;
}

async function getRelated(boardId: number, excludeId: number) {
  return db
    .select({
      id: boardNotifications.id,
      title: boardNotifications.title,
      slug: boardNotifications.slug,
      category: boardNotifications.category,
      publishedAt: boardNotifications.publishedAt,
    })
    .from(boardNotifications)
    .where(
      and(
        eq(boardNotifications.boardId, boardId),
        ne(boardNotifications.id, excludeId)
      )
    )
    .orderBy(desc(boardNotifications.publishedAt))
    .limit(5);
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const notification = await getNotification(slug);
  if (!notification) return { title: "Notification Not Found | Padvik" };

  return {
    title: `${notification.title} | Padvik`,
    description: notification.summary ?? `${notification.boardName} notification: ${notification.title}`,
  };
}

export default async function NotificationDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const notification = await getNotification(slug);

  if (!notification) notFound();

  const related = await getRelated(notification.boardId, notification.id);

  return (
    <div className="min-h-screen bg-background">
      {/* Navbar */}
      <nav className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-4xl items-center justify-between px-4">
          <Link href="/">
            <PadvikLogo size="lg" />
          </Link>
        </div>
      </nav>

      <main className="mx-auto max-w-4xl px-4 py-10">
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to home
        </Link>

        <article className="mt-6">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="default">
              {notification.boardCode}
            </Badge>
            <Badge variant="secondary">
              {CATEGORY_LABELS[notification.category] ?? "General"}
            </Badge>
            {notification.isBreaking && (
              <Badge variant="destructive">Breaking</Badge>
            )}
          </div>

          <h1 className="mt-4 text-3xl font-bold tracking-tight">
            {notification.title}
          </h1>

          <div className="mt-3 flex items-center gap-4 text-sm text-muted-foreground">
            <span>{notification.boardName}</span>
            <span>Published: {notification.publishedAt}</span>
          </div>

          {notification.summary && (
            <div className="mt-6 rounded-lg border bg-muted/30 p-4">
              <p className="text-sm font-medium text-muted-foreground">AI Summary</p>
              <p className="mt-1">{notification.summary}</p>
            </div>
          )}

          {notification.affectedClasses && notification.affectedClasses.length > 0 && (
            <div className="mt-4">
              <p className="text-sm font-medium text-muted-foreground">Affected Classes</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {notification.affectedClasses.map((c) => (
                  <Badge key={c} variant="outline" className="text-xs">
                    Class {c}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          <div className="mt-6 flex flex-wrap gap-3">
            {notification.pdfUrl && (
              <a href={notification.pdfUrl} target="_blank" rel="noopener noreferrer">
                <Button variant="default">
                  <FileDown className="mr-2 size-4" />
                  Download PDF
                </Button>
              </a>
            )}
            <a href={notification.sourceUrl} target="_blank" rel="noopener noreferrer">
              <Button variant="outline">
                <ExternalLink className="mr-2 size-4" />
                View Original
              </Button>
            </a>
          </div>
        </article>

        {/* Related Notifications */}
        {related.length > 0 && (
          <section className="mt-12 border-t pt-8">
            <h2 className="text-lg font-semibold">
              More from {notification.boardName}
            </h2>
            <div className="mt-4 space-y-3">
              {related.map((r) => (
                <Link
                  key={r.id}
                  href={r.slug ? `/notifications/${r.slug}` : "#"}
                  className="flex items-center justify-between rounded-lg border p-3 transition-colors hover:bg-muted/50"
                >
                  <div>
                    <Badge variant="outline" className="mb-1 text-xs">
                      {CATEGORY_LABELS[r.category] ?? "General"}
                    </Badge>
                    <p className="text-sm font-medium">{r.title}</p>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {r.publishedAt}
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* CTA */}
        <section className="mt-12 rounded-xl border bg-violet-50/50 p-8 text-center dark:bg-violet-950/20">
          <h3 className="text-xl font-bold">Get board updates instantly</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Sign up for free to get personalized notifications for your board and class.
          </p>
          <Link href="/login" className="mt-4 inline-block">
            <Button>
              Sign up free
              <ChevronRight className="ml-1 size-4" />
            </Button>
          </Link>
        </section>
      </main>
    </div>
  );
}
