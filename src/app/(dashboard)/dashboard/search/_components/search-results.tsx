"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  Search,
  Send,
  Loader2,
  BookOpen,
  Play,
  Activity,
  FileText,
  Video,
  History,
  Sparkles,
  Info,
  ChevronRight,
  ClipboardList,
  ExternalLink,
  BadgeCheck,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ContentTypeIcon } from "@/components/content/content-type-icon";
import { TopicSearchBox } from "@/components/search/topic-search-box";
import { VisualCardsButton } from "@/components/explainer/VisualCardsButton";
import type { ContentBlock } from "@/lib/explainer/types";
import { cn } from "@/lib/utils";
import { useBoardSelection } from "@/hooks/use-board-selection";
import { setActiveTopic, clearActiveTopic } from "@/hooks/use-active-topic";

// Heavy renderers (react-markdown + KaTeX + mermaid) are lazy-loaded so the
// search page shell navigates in instantly; they hydrate when an article
// actually needs them.
const MarkdownRenderer = dynamic(
  () => import("@/components/content/markdown-renderer").then((m) => m.MarkdownRenderer),
  { ssr: false, loading: () => <Skeleton className="h-24 w-full rounded-lg" /> }
);
const BlockView = dynamic(
  () => import("@/components/explainer/blocks").then((m) => m.BlockView),
  { ssr: false }
);

// ---------------------------------------------------------------------------
// Types (mirror the API shapes)
// ---------------------------------------------------------------------------

interface TopicHit {
  topicId: number;
  title: string;
  chapterTitle: string;
  subjectName: string;
  grade: number;
  boardCode: string;
}

interface SearchResponse {
  rejected: boolean;
  reason?: string;
  landingTopicId: number | null;
  topics: TopicHit[];
}

interface Article {
  key: string;
  id: number;
  source: "content_item" | "creator";
  contentType: string;
  title: string;
  language: string;
  isOfficial: boolean;
  format: "markdown" | "blocks";
  markdown?: string;
  blocks?: unknown[];
  viewerHref: string;
}

interface QuestionSet {
  contentId: number;
  title: string;
  isOfficial: boolean;
  questions: Array<Record<string, unknown>>;
}

interface Bundle {
  topic: { id: number; title: string; chapterTitle: string; subjectName: string; grade: number; boardCode: string };
  articles: Article[];
  media: {
    videos: Array<{ contentId: number; url: string; title: string; durationSeconds: number | null; thumbnailUrl: string | null; isOfficial: boolean }>;
    audios: Array<{ contentId: number; url: string; title: string; durationSeconds: number | null; isOfficial: boolean }>;
    documents: Array<{ contentId: number; url: string; title: string; fileName: string; isOfficial: boolean }>;
    images: Array<{ contentId: number; url: string; title: string; isOfficial: boolean }>;
  };
  questionSets: QuestionSet[];
  userVideos: Array<{ id: number; youtubeUrl: string; title: string | null; thumbnailUrl: string | null; durationSeconds: number | null }>;
  related: Array<{ topicId: number; title: string; similarityScore: number | null }>;
}

interface HistoryItem {
  id: number;
  query: string;
  matchedTopicId: number | null;
  topicTitle: string | null;
  subjectName: string | null;
  resultCount: number;
  createdAt: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp?: string;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function SearchResults({ query, topicId }: { query: string; topicId: number | null }) {
  const router = useRouter();
  const { boardId, grade } = useBoardSelection();

  const [searching, setSearching] = useState(false);
  const [result, setResult] = useState<SearchResponse | null>(null);
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [bundleLoading, setBundleLoading] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [searchMs, setSearchMs] = useState<number | null>(null);
  const [searchedAt, setSearchedAt] = useState<Date | null>(null);

  // Restore the last search when landing on /dashboard/search with no ?q
  // (e.g. the sidebar "Search" link). Runs once on mount; if there's a stored
  // search it redirects to it, so coming back shows the previous results.
  useEffect(() => {
    if (query && query.trim().length >= 2) return; // already have a query
    try {
      const raw = sessionStorage.getItem("padvik:lastSearch");
      if (!raw) return;
      const saved = JSON.parse(raw) as { q?: string; topicId?: number | null };
      if (saved.q && saved.q.trim().length >= 2) {
        const p = new URLSearchParams({ q: saved.q });
        if (saved.topicId) p.set("topicId", String(saved.topicId));
        router.replace(`/dashboard/search?${p.toString()}`);
      }
    } catch {
      /* ignore */
    }
    // mount-only — restoring once is enough; a real query takes over after.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Run the unified search whenever the query (or board context) changes.
  useEffect(() => {
    if (!query || query.trim().length < 2) {
      setResult(null);
      setBundle(null);
      return;
    }
    let cancelled = false;
    setSearching(true);
    // Stamp the search time immediately so the heading renders right away —
    // the page shouldn't wait on the (async) search call to feel responsive.
    setSearchedAt(new Date());
    setSearchMs(null);
    const params = new URLSearchParams({ q: query });
    if (boardId) params.set("boardId", String(boardId));
    if (grade) params.set("grade", String(grade));

    const t0 = performance.now();
    fetch(`/api/learn/topic-search?${params.toString()}`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        setSearchMs(Math.round(performance.now() - t0));
        if (json?.success) setResult(json.data as SearchResponse);
        else setResult(null);
      })
      .catch(() => { if (!cancelled) setResult(null); })
      .finally(() => { if (!cancelled) setSearching(false); });

    return () => { cancelled = true; };
  }, [query, boardId, grade]);

  // The landing topic: explicit ?topicId wins, else the search's best match.
  const landingTopicId = topicId ?? result?.landingTopicId ?? null;

  // Persist the last search (query + landed topic) so returning to the Search
  // page restores it.
  useEffect(() => {
    if (!query || query.trim().length < 2) return;
    try {
      sessionStorage.setItem(
        "padvik:lastSearch",
        JSON.stringify({ q: query, topicId: landingTopicId })
      );
    } catch {
      /* ignore */
    }
  }, [query, landingTopicId]);

  // Fetch the content/media bundle for the landing topic.
  useEffect(() => {
    if (!landingTopicId || result?.rejected) {
      setBundle(null);
      return;
    }
    let cancelled = false;
    setBundleLoading(true);
    fetch(`/api/learn/topic/${landingTopicId}/bundle`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        setBundle(json?.success ? (json.data as Bundle) : null);
      })
      .catch(() => { if (!cancelled) setBundle(null); })
      .finally(() => { if (!cancelled) setBundleLoading(false); });
    return () => { cancelled = true; };
  }, [landingTopicId, result?.rejected]);

  // Recent searches.
  const loadHistory = useCallback(() => {
    fetch("/api/learn/topic-search/history?limit=20")
      .then((r) => r.json())
      .then((json) => { if (json?.success) setHistory(json.data.history ?? []); })
      .catch(() => {});
  }, []);
  // Reload on mount/query change AND once the search completes — the history
  // row is inserted server-side during the search, so refetching when `result`
  // arrives makes the just-searched term appear instantly.
  useEffect(() => { loadHistory(); }, [loadHistory, query, result]);

  // Publish the landed topic so the global floating chat picks it up as context.
  useEffect(() => {
    if (bundle?.topic && !result?.rejected) {
      setActiveTopic({
        topicId: bundle.topic.id,
        title: bundle.topic.title,
        subject: bundle.topic.subjectName,
        boardCode: bundle.topic.boardCode,
        grade: bundle.topic.grade,
      });
    }
  }, [bundle?.topic, result?.rejected]);
  // Clear when leaving the search page.
  useEffect(() => () => clearActiveTopic(), []);

  const runSearch = (q: string, landTopicId?: number) => {
    const trimmed = q.trim();
    if (trimmed.length < 2) return;
    const params = new URLSearchParams({ q: trimmed });
    if (landTopicId) params.set("topicId", String(landTopicId));
    router.push(`/dashboard/search?${params.toString()}`);
  };

  const clearHistory = (id?: number) => {
    fetch(`/api/learn/topic-search/history${id ? `?id=${id}` : ""}`, { method: "DELETE" })
      .then(() => loadHistory())
      .catch(() => {});
  };

  return (
    <div className="space-y-4 pt-2">
      {/* Search box with live autocomplete */}
      <TopicSearchBox boardId={boardId} grade={grade} initialValue={query} loading={searching} />

      {/* Search-term heading with timestamp + duration — renders immediately
          (not gated on the async search) so navigation feels instant. */}
      {query.trim().length >= 2 && (
        <div className="rounded-xl bg-gradient-to-r from-violet-600 to-violet-500 p-4 text-white shadow-sm">
          <p className="text-[11px] font-medium uppercase tracking-wide text-white/70">
            Search results for
          </p>
          <h1 className="break-words text-lg font-bold sm:text-xl">“{query.trim()}”</h1>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] text-white/80">
            {searchedAt && <span>Searched {formatSearchedAt(searchedAt)}</span>}
            {searchedAt && (searching || searchMs != null) && <span aria-hidden>·</span>}
            {searching ? (
              <span className="inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> searching…</span>
            ) : searchMs != null ? (
              <span>found in {searchMs} ms</span>
            ) : null}
          </p>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        {/* Main column */}
        <div className="space-y-4 min-w-0">
          {/* Only show the top skeleton while resolving the landing topic from a
              text search. When a topicId is already in the URL (topic selected),
              the bundle below shows its own loader — no lingering skeleton. */}
          {searching && !result && !landingTopicId && (
            <div className="space-y-3">
              <Skeleton className="h-16 rounded-lg" />
              <Skeleton className="h-40 rounded-lg" />
            </div>
          )}

          {/* Rejected card */}
          {result?.rejected && (
            <Card className="border-violet-200 bg-violet-50 dark:border-violet-900 dark:bg-violet-950/30">
              <CardContent className="flex items-start gap-3 p-5">
                <Info className="mt-0.5 h-5 w-5 shrink-0 text-violet-600" />
                <div>
                  <p className="font-semibold text-violet-900 dark:text-violet-200">
                    Padvik search is for your syllabus.
                  </p>
                  <p className="mt-1 text-sm text-violet-800/80 dark:text-violet-300/80">
                    Try a topic like &quot;Ohm&apos;s law&quot; or &quot;quadratic equations&quot;.
                  </p>
                  {result.reason && (
                    <p className="mt-2 text-xs italic text-violet-700/70 dark:text-violet-400/70">
                      {result.reason}
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* No results */}
          {result && !result.rejected && !landingTopicId && !searching && (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
                <Search className="h-8 w-8 text-muted-foreground/50" />
                <p className="font-medium">No topics found for &quot;{query}&quot;</p>
                <p className="text-sm text-muted-foreground">
                  Try different keywords or check your spelling.
                </p>
              </CardContent>
            </Card>
          )}

          {/* Landing topic bundle */}
          {landingTopicId && !result?.rejected && (
            <TopicBundle
              topicId={landingTopicId}
              bundle={bundle}
              loading={bundleLoading}
              otherTopics={result?.topics?.filter((t) => t.topicId !== landingTopicId) ?? []}
              onPickTopic={(t) => runSearch(query || t.title, t.topicId)}
            />
          )}
        </div>

        {/* Right rail — recent searches */}
        <aside className="space-y-3">
          <Card>
            <CardContent className="p-4">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                  <History className="h-4 w-4 text-violet-600" />
                  Recently searched
                </h3>
                {/* Clear button hidden for now — re-enable when needed.
                {history.length > 0 && (
                  <button
                    onClick={() => clearHistory()}
                    className="text-xs text-muted-foreground hover:text-violet-600"
                  >
                    Clear
                  </button>
                )}
                */}
              </div>
              {history.length === 0 ? (
                <p className="py-2 text-xs text-muted-foreground">No searches yet.</p>
              ) : (
                <ul className="space-y-1">
                  {history.map((h) => (
                    <li key={h.id}>
                      <button
                        onClick={() => runSearch(h.query, h.matchedTopicId ?? undefined)}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-violet-50 dark:hover:bg-violet-950/30"
                      >
                        <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate">
                          {h.topicTitle ?? h.query}
                          {h.subjectName && (
                            <span className="ml-1 text-[10px] text-muted-foreground">· {h.subjectName}</span>
                          )}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Topic bundle — header, content sections, media, related, chat
// ---------------------------------------------------------------------------

function formatDuration(seconds: number | null): string | null {
  if (!seconds || seconds <= 0) return null;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** "23 Jun 2026, 3:14 PM" — date + time of the search. */
function formatSearchedAt(d: Date): string {
  return d.toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function TopicBundle({
  topicId,
  bundle,
  loading,
  otherTopics,
  onPickTopic,
}: {
  topicId: number;
  bundle: Bundle | null;
  loading: boolean;
  otherTopics: TopicHit[];
  onPickTopic: (t: TopicHit) => void;
}) {
  if (loading && !bundle) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-16 rounded-lg" />
        <Skeleton className="h-40 rounded-lg" />
      </div>
    );
  }
  if (!bundle) return null;

  const { topic, articles, media, questionSets, userVideos, related } = bundle;
  const isEmpty =
    articles.length === 0 &&
    media.videos.length === 0 &&
    media.audios.length === 0 &&
    media.documents.length === 0 &&
    media.images.length === 0 &&
    questionSets.length === 0 &&
    userVideos.length === 0;

  return (
    <div className="space-y-4">
      {/* Topic header */}
      <Card>
        <CardContent className="p-5">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="secondary" className="text-[10px]">{topic.subjectName}</Badge>
            <span>{topic.chapterTitle}</span>
            <span>·</span>
            <span>Class {topic.grade}</span>
            <span>·</span>
            <span>{topic.boardCode}</span>
          </div>
          <h1 className="mt-2 text-xl font-bold sm:text-2xl">{topic.title}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button asChild size="sm" className="bg-violet-600 hover:bg-violet-700">
              <Link href={`/dashboard/learn/${topic.id}`}>
                <BookOpen className="mr-1.5 h-4 w-4" /> Open in Playground
              </Link>
            </Button>
            {/* Adaptive visual card deck — reuses the existing explainer entry
                point (status-only, never generates here; opens /topics/[id]/learn). */}
            <VisualCardsButton topicId={topic.id} showHelp />
          </div>
        </CardContent>
      </Card>

      {/* Other topic matches */}
      {otherTopics.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <h3 className="mb-2 text-sm font-semibold">Other matches</h3>
            <div className="flex flex-wrap gap-2">
              {otherTopics.slice(0, 8).map((t) => (
                <button
                  key={t.topicId}
                  onClick={() => onPickTopic(t)}
                  className="rounded-full border px-3 py-1 text-xs hover:border-violet-400 hover:bg-violet-50 dark:hover:bg-violet-950/30"
                >
                  {t.title}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Notes & Articles — full content inline */}
      {articles.length > 0 && (
        <Section title="Notes & Articles" icon={<BookOpen className="h-4 w-4 text-violet-600" />}>
          <div className="space-y-3">
            {articles.map((a) => (
              <ArticleCard key={a.key} article={a} />
            ))}
          </div>
        </Section>
      )}

      {/* Videos — inline players (YouTube embed or file) */}
      {media.videos.length > 0 && (
        <Section title="Videos" icon={<Play className="h-4 w-4 text-blue-500" />}>
          <div className="grid gap-3 sm:grid-cols-2">
            {media.videos.map((v, i) => {
              const embed = youtubeEmbedUrl(v.url);
              return (
                <div key={`${v.contentId}-${i}`} className="overflow-hidden rounded-lg border">
                  {embed ? (
                    <iframe
                      src={embed}
                      title={v.title}
                      className="aspect-video w-full bg-black"
                      allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                    />
                  ) : (
                    <video controls preload="metadata" poster={v.thumbnailUrl ?? undefined} src={v.url} className="aspect-video w-full bg-black" />
                  )}
                  <div className="flex items-center justify-between gap-2 p-2">
                    <span className="flex min-w-0 items-center gap-1.5 truncate text-xs font-medium">
                      {v.isOfficial && <OfficialBadge />}
                      <span className="truncate">{v.title}</span>
                    </span>
                    {formatDuration(v.durationSeconds) && (
                      <span className="shrink-0 text-[10px] text-muted-foreground">{formatDuration(v.durationSeconds)}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* Audio */}
      {media.audios.length > 0 && (
        <Section title="Audio" icon={<Activity className="h-4 w-4 text-green-500" />}>
          <div className="space-y-2">
            {media.audios.map((a, i) => (
              <div key={`${a.contentId}-${i}`} className="rounded-lg border p-3">
                <div className="mb-1.5 flex items-center gap-2">
                  <Activity className="h-3.5 w-3.5 text-green-500" />
                  {a.isOfficial && <OfficialBadge />}
                  <span className="truncate text-sm font-medium">{a.title}</span>
                </div>
                <audio controls preload="metadata" src={a.url} className="w-full" />
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Practice questions — inline */}
      {questionSets.length > 0 && (
        <Section title="Practice questions" icon={<ClipboardList className="h-4 w-4 text-amber-500" />}>
          <div className="space-y-3">
            {questionSets.map((qs) => (
              <QuestionSetCard key={qs.contentId} set={qs} />
            ))}
          </div>
        </Section>
      )}

      {/* Documents */}
      {media.documents.length > 0 && (
        <Section title="Documents" icon={<FileText className="h-4 w-4 text-red-500" />}>
          <div className="space-y-2">
            {media.documents.map((d, i) => (
              <a
                key={`${d.contentId}-${i}`}
                href={d.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 rounded-lg border p-3 text-sm hover:border-violet-300 hover:bg-violet-50/50 dark:hover:bg-violet-950/20"
              >
                <FileText className="h-4 w-4 shrink-0 text-red-500" />
                {d.isOfficial && <OfficialBadge />}
                <span className="min-w-0 flex-1 truncate font-medium">{d.title}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground">{d.fileName}</span>
              </a>
            ))}
          </div>
        </Section>
      )}

      {/* Images */}
      {media.images.length > 0 && (
        <Section title="Images" icon={<Sparkles className="h-4 w-4 text-amber-500" />}>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {media.images.map((img, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={`${img.contentId}-${i}`} src={img.url} alt={img.title} className="aspect-square w-full rounded-lg border object-cover" />
            ))}
          </div>
        </Section>
      )}

      {/* Your saved videos */}
      {userVideos.length > 0 && (
        <Section title="Your saved videos" icon={<Video className="h-4 w-4 text-pink-500" />}>
          <div className="grid gap-2 sm:grid-cols-2">
            {userVideos.map((v) => (
              <a
                key={v.id}
                href={v.youtubeUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 rounded-lg border p-2 text-sm hover:border-violet-300 hover:bg-violet-50/50 dark:hover:bg-violet-950/20"
              >
                {v.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={v.thumbnailUrl} alt="" className="h-10 w-16 shrink-0 rounded object-cover" />
                ) : (
                  <Video className="h-4 w-4 shrink-0 text-pink-500" />
                )}
                <span className="min-w-0 flex-1 truncate">{v.title ?? v.youtubeUrl}</span>
              </a>
            ))}
          </div>
        </Section>
      )}

      {/* Empty content state */}
      {isEmpty && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-2 py-8 text-center">
            <Sparkles className="h-7 w-7 text-violet-400" />
            <p className="text-sm font-medium">No content yet for this topic</p>
            <p className="text-xs text-muted-foreground">
              Ask the AI tutor below, or open it in the Playground to start learning.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Related topics */}
      {related.length > 0 && (
        <Section title="Related topics" icon={<ChevronRight className="h-4 w-4 text-violet-600" />}>
          <div className="flex flex-wrap gap-2">
            {related.map((r) => (
              <Link
                key={r.topicId}
                href={`/dashboard/search?q=${encodeURIComponent(r.title)}&topicId=${r.topicId}`}
                className="rounded-full border px-3 py-1 text-xs hover:border-violet-400 hover:bg-violet-50 dark:hover:bg-violet-950/30"
              >
                {r.title}
              </Link>
            ))}
          </div>
        </Section>
      )}

      {/* In-page AI tutor */}
      <TopicChat
        topicId={topic.id}
        topicTitle={topic.title}
        subject={topic.subjectName}
        board={topic.boardCode}
        grade={topic.grade}
      />
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="p-4">
        <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold">{icon}{title}</h3>
        {children}
      </CardContent>
    </Card>
  );
}

/** "Padvik Official" badge for system-creator content. */
function OfficialBadge() {
  return (
    <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-violet-100 px-1.5 py-0.5 text-[9px] font-medium text-violet-700 dark:bg-violet-950/50 dark:text-violet-300">
      <BadgeCheck className="h-3 w-3" /> Padvik Official
    </span>
  );
}

/** Convert a YouTube watch/share URL into an embeddable URL (or null). */
function youtubeEmbedUrl(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(/(?:v=|youtu\.be\/|\/embed\/|\/shorts\/)([a-zA-Z0-9_-]{11})/);
  return m ? `https://www.youtube.com/embed/${m[1]}` : null;
}

// ---------------------------------------------------------------------------
// Article card — renders full inline content (markdown or ContentBlock[])
// ---------------------------------------------------------------------------

function ArticleCard({ article }: { article: Article }) {
  const [open, setOpen] = useState(true);
  const label = article.source === "content_item" ? "Open in Playground" : "Open full page";

  return (
    <div className="rounded-lg border">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <ContentTypeIcon type={article.contentType} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{article.title}</span>
        {article.isOfficial && <OfficialBadge />}
        <button
          onClick={() => setOpen((o) => !o)}
          className="shrink-0 text-[11px] text-muted-foreground hover:text-violet-600"
        >
          {open ? "Collapse" : "Expand"}
        </button>
      </div>
      {open && (
        <div className="px-4 py-3">
          {article.format === "markdown" && article.markdown ? (
            <MarkdownRenderer content={article.markdown} />
          ) : article.format === "blocks" && article.blocks ? (
            <div className="space-y-4">
              {(article.blocks as ContentBlock[]).map((b, i) => (
                <BlockView key={i} block={b} />
              ))}
            </div>
          ) : null}
        </div>
      )}
      <div className="border-t px-3 py-2">
        <Button asChild size="sm" variant="outline" className="gap-1.5">
          <Link href={article.viewerHref}>
            {article.source === "content_item" ? <BookOpen className="h-3.5 w-3.5" /> : <ExternalLink className="h-3.5 w-3.5" />}
            {label}
          </Link>
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Question set — inline, with show/hide answers (mirrors the content viewer)
// ---------------------------------------------------------------------------

interface QuestionLike {
  questionText: string;
  options?: Array<{ id: string; text: string; isCorrect: boolean }>;
  correctAnswer?: string;
  solution?: string;
  marks?: number;
  difficulty?: string;
}

function QuestionSetCard({ set }: { set: QuestionSet }) {
  return (
    <div className="rounded-lg border">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <ClipboardList className="h-4 w-4 text-amber-500" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{set.title}</span>
        {set.isOfficial && <OfficialBadge />}
        <span className="shrink-0 text-[10px] text-muted-foreground">{set.questions.length} Q</span>
      </div>
      <div className="space-y-3 p-3">
        {set.questions.map((q, i) => (
          <QuestionItem key={i} index={i} q={q as unknown as QuestionLike} />
        ))}
      </div>
    </div>
  );
}

function QuestionItem({ index, q }: { index: number; q: QuestionLike }) {
  const [showAnswer, setShowAnswer] = useState(false);
  return (
    <div className="rounded-md border p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium">
          <span className="mr-1 text-violet-600">Q{index + 1}.</span>
          {q.questionText}
        </p>
        {q.marks != null && (
          <Badge variant="outline" className="shrink-0 text-[9px]">{q.marks} mark{q.marks > 1 ? "s" : ""}</Badge>
        )}
      </div>
      {q.options && q.options.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {q.options.map((o) => (
            <li
              key={o.id}
              className={cn(
                "flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm",
                showAnswer && o.isCorrect && "border-green-500 bg-green-500/10"
              )}
            >
              <span className="font-medium">{o.id}.</span>
              <span className="flex-1">{o.text}</span>
            </li>
          ))}
        </ul>
      )}
      <button
        onClick={() => setShowAnswer((s) => !s)}
        className="mt-2 text-xs text-violet-600 hover:underline"
      >
        {showAnswer ? "Hide answer" : "Show answer"}
      </button>
      {showAnswer && (
        <div className="mt-2 space-y-1 rounded-md bg-muted/50 p-2 text-sm">
          {q.correctAnswer && <p><span className="font-medium">Answer: </span>{q.correctAnswer}</p>}
          {q.solution && <p className="whitespace-pre-wrap text-muted-foreground">{q.solution}</p>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// In-page AI tutor — reuses /api/learn/chat + topic_conversations (no new table)
// ---------------------------------------------------------------------------

function TopicChat({
  topicId,
  topicTitle,
  subject,
  board,
  grade,
}: {
  topicId: number;
  topicTitle: string;
  subject: string;
  board: string;
  grade: number;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [conversationId, setConversationId] = useState<number | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const scopePreamble =
    `You are tutoring on the topic "${topicTitle}" (${subject}, ${board} Class ${grade}). ` +
    `Answer questions about THIS topic and its syllabus only; politely decline unrelated requests.`;

  // Load the most recent conversation history for this topic.
  useEffect(() => {
    let cancelled = false;
    setMessages([]);
    setConversationId(null);
    fetch(`/api/learn/chat?topicId=${topicId}`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled || !json?.success) return;
        const convo = (json.data ?? [])[0];
        if (convo) {
          setConversationId(convo.id);
          setMessages(
            (convo.messages ?? []).map((m: ChatMessage) => ({ role: m.role, content: m.content }))
          );
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [topicId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", content: text }]);
    setSending(true);
    try {
      const res = await fetch("/api/learn/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topicId,
          message: text,
          conversationId,
          topicScopePreamble: scopePreamble,
        }),
      });
      const json = await res.json();
      if (json?.success) {
        setConversationId(json.data.conversationId);
        setMessages((m) => [...m, { role: "assistant", content: json.data.message }]);
      } else {
        setMessages((m) => [...m, { role: "assistant", content: "Sorry, I couldn't answer that. Please try again." }]);
      }
    } catch {
      setMessages((m) => [...m, { role: "assistant", content: "Network error. Please try again." }]);
    } finally {
      setSending(false);
    }
  };

  return (
    <Card className="border-violet-200 dark:border-violet-900">
      <CardContent className="p-4">
        <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
          <Sparkles className="h-4 w-4 text-violet-600" />
          Ask about {topicTitle}
        </h3>

        <div className="max-h-80 space-y-3 overflow-y-auto">
          {messages.length === 0 && (
            <p className="py-4 text-center text-xs text-muted-foreground">
              Ask anything about this topic — definitions, examples, doubts.
            </p>
          )}
          {messages.map((m, i) => (
            <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
              <div
                className={
                  m.role === "user"
                    ? "max-w-[85%] rounded-2xl rounded-br-sm bg-violet-600 px-3 py-2 text-sm text-white"
                    : "max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-bl-sm bg-muted px-3 py-2 text-sm"
                }
              >
                {m.content}
              </div>
            </div>
          ))}
          {sending && (
            <div className="flex justify-start">
              <div className="rounded-2xl rounded-bl-sm bg-muted px-3 py-2 text-sm">
                <Loader2 className="h-4 w-4 animate-spin text-violet-600" />
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>

        <form
          onSubmit={(e) => { e.preventDefault(); send(); }}
          className="mt-3 flex items-center gap-2"
        >
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask the AI tutor…"
            className="h-10 focus-visible:ring-violet-500"
            disabled={sending}
          />
          <Button
            type="submit"
            size="icon"
            className="h-10 w-10 shrink-0 bg-violet-600 hover:bg-violet-700"
            disabled={sending || !input.trim()}
          >
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
