"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Route,
  RefreshCw,
  Loader2,
  BookOpen,
  Play,
  ClipboardList,
  CheckCircle2,
  Sparkles,
  GraduationCap,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useBoardSelection } from "@/hooks/use-board-selection";
import { getSubjects } from "@/lib/data";

interface ImprovementItem {
  topicId: number;
  title: string;
  reason: string;
  priority: "high" | "medium" | "low";
  suggestedAction: string;
  contentItemId?: number;
}
interface StrengthItem {
  topicId: number;
  title: string;
  reason: string;
}
interface PathData {
  summary: string | null;
  strengths: StrengthItem[];
  improvements: ImprovementItem[];
  overallScore: number;
  generatedAt: string;
}

interface SubjectChip {
  id: number;
  name: string;
}

// ---------------------------------------------------------------------------
// Action deep-link resolver — maps the AI/templated action to a Playground panel
// ---------------------------------------------------------------------------

function actionLink(item: ImprovementItem): string {
  const a = item.suggestedAction.toLowerCase();
  if (a.includes("watch") || a.includes("video")) return `/dashboard/learn/${item.topicId}?panel=videos`;
  if (a.includes("practi") || a.includes("mcq") || a.includes("exercise") || a.includes("quiz"))
    return `/dashboard/learn/${item.topicId}?panel=exercises`;
  return `/dashboard/learn/${item.topicId}`;
}

function actionIcon(item: ImprovementItem) {
  const a = item.suggestedAction.toLowerCase();
  if (a.includes("watch") || a.includes("video")) return <Play className="h-3.5 w-3.5" />;
  if (a.includes("practi") || a.includes("mcq") || a.includes("exercise") || a.includes("quiz"))
    return <ClipboardList className="h-3.5 w-3.5" />;
  return <BookOpen className="h-3.5 w-3.5" />;
}

const PRIORITY_DOT: Record<string, string> = {
  high: "bg-red-500",
  medium: "bg-orange-500",
  low: "bg-yellow-500",
};

// ---------------------------------------------------------------------------
// Readiness ring
// ---------------------------------------------------------------------------

function ReadinessRing({ score }: { score: number }) {
  const radius = 36;
  const circ = 2 * Math.PI * radius;
  const pct = Math.max(0, Math.min(100, score));
  const offset = circ - (pct / 100) * circ;
  const color = pct >= 70 ? "text-emerald-500" : pct >= 40 ? "text-amber-500" : "text-red-500";

  return (
    <div className="relative h-24 w-24 shrink-0">
      <svg className="h-24 w-24 -rotate-90" viewBox="0 0 88 88">
        <circle cx="44" cy="44" r={radius} strokeWidth="8" className="fill-none stroke-muted" />
        <circle
          cx="44"
          cy="44"
          r={radius}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          className={`fill-none stroke-current transition-all ${color}`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold tabular-nums">{Math.round(pct)}</span>
        <span className="text-[9px] text-muted-foreground">readiness</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export function LearningPathView() {
  const { boardId, grade } = useBoardSelection();
  const [subjects, setSubjects] = useState<SubjectChip[]>([]);
  const [subjectId, setSubjectId] = useState<number | null>(null);
  const [data, setData] = useState<PathData | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Load subjects for the filter chips.
  useEffect(() => {
    if (!boardId || !grade) return;
    getSubjects(boardId, grade)
      .then((subs) => setSubjects((subs ?? []).map((s) => ({ id: s.id, name: s.name }))))
      .catch(() => {});
  }, [boardId, grade]);

  const load = useCallback(
    (refresh: boolean) => {
      if (!boardId || !grade) return;
      const params = new URLSearchParams({ boardId: String(boardId), grade: String(grade) });
      if (subjectId) params.set("subjectId", String(subjectId));
      if (refresh) params.set("refresh", "1");

      if (refresh) setRefreshing(true);
      else setLoading(true);

      fetch(`/api/learn/path?${params.toString()}`)
        .then((r) => r.json())
        .then((json) => { if (json?.success) setData(json.data as PathData); })
        .catch(() => {})
        .finally(() => { setLoading(false); setRefreshing(false); });
    },
    [boardId, grade, subjectId]
  );

  useEffect(() => { load(false); }, [load]);

  const hasContent =
    data && (data.improvements.length > 0 || data.strengths.length > 0 || (data.overallScore ?? 0) > 0);

  return (
    <div className="space-y-4 pt-2">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Route className="h-6 w-6 text-violet-600" />
            Your learning path
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            What to focus on next, based on your real progress.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => load(true)}
          disabled={refreshing || loading || !boardId}
          className="shrink-0"
        >
          {refreshing ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1.5 h-4 w-4" />}
          Refresh
        </Button>
      </div>

      {/* No board selected */}
      {!boardId && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <GraduationCap className="h-9 w-9 text-primary/50" />
            <p className="font-medium">Select your board & class first</p>
            <p className="text-sm text-muted-foreground">
              Set up your profile to get a personalised learning path.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Subject filter chips */}
      {boardId && subjects.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setSubjectId(null)}
            className={`rounded-full border px-3 py-1 text-xs transition-colors ${
              subjectId === null
                ? "border-violet-500 bg-violet-600 text-white"
                : "hover:border-violet-400 hover:bg-violet-50 dark:hover:bg-violet-950/30"
            }`}
          >
            All subjects
          </button>
          {subjects.map((s) => (
            <button
              key={s.id}
              onClick={() => setSubjectId(s.id)}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                subjectId === s.id
                  ? "border-violet-500 bg-violet-600 text-white"
                  : "hover:border-violet-400 hover:bg-violet-50 dark:hover:bg-violet-950/30"
              }`}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}

      {/* Loading */}
      {boardId && loading && !data && (
        <div className="space-y-3">
          <Skeleton className="h-28 rounded-lg" />
          <Skeleton className="h-40 rounded-lg" />
        </div>
      )}

      {/* Empty state for new students */}
      {boardId && !loading && data && !hasContent && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <Sparkles className="h-9 w-9 text-violet-400" />
            <p className="font-medium">Start learning a few topics and I&apos;ll map out what to focus on.</p>
            <p className="text-sm text-muted-foreground">
              Read some notes and rate your understanding — your path appears here.
            </p>
            <Button asChild className="mt-2 bg-violet-600 hover:bg-violet-700">
              <Link href="/dashboard/learn">Go to My Learning</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Summary + readiness */}
      {boardId && data && hasContent && (
        <>
          <Card>
            <CardContent className="flex items-center gap-4 p-5">
              <ReadinessRing score={data.overallScore ?? 0} />
              <div>
                <h2 className="text-sm font-semibold">Where you stand</h2>
                <p className="mt-1 text-sm text-muted-foreground">{data.summary}</p>
              </div>
            </CardContent>
          </Card>

          {/* Improve these */}
          {data.improvements.length > 0 && (
            <div className="space-y-2">
              <h2 className="text-sm font-semibold">Improve these</h2>
              <div className="space-y-2">
                {data.improvements.map((item) => (
                  <Card key={item.topicId}>
                    <CardContent className="flex items-center gap-3 p-3">
                      <span className={`mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full ${PRIORITY_DOT[item.priority] ?? "bg-muted"}`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/dashboard/learn/${item.topicId}`}
                            className="truncate text-sm font-medium hover:text-violet-600 hover:underline"
                          >
                            {item.title}
                          </Link>
                          <Badge variant="outline" className="shrink-0 text-[9px] uppercase">{item.priority}</Badge>
                        </div>
                        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{item.reason}</p>
                      </div>
                      <Button asChild size="sm" variant="outline" className="shrink-0 gap-1.5">
                        <Link href={actionLink(item)}>
                          {actionIcon(item)}
                          <span className="hidden sm:inline">{item.suggestedAction}</span>
                          <span className="sm:hidden">Go</span>
                        </Link>
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* You're strong in */}
          {data.strengths.length > 0 && (
            <div className="space-y-2">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                You&apos;re strong in
              </h2>
              <div className="flex flex-wrap gap-2">
                {data.strengths.map((s) => (
                  <Link
                    key={s.topicId}
                    href={`/dashboard/learn/${s.topicId}`}
                    className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs text-emerald-700 hover:bg-emerald-100 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300"
                  >
                    {s.title}
                  </Link>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
