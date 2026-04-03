"use client";

import { useState, useMemo, Fragment } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ChevronRight,
  ChevronDown,
  GraduationCap,
  BookOpen,
  Layers,
  FileText,
  ExternalLink,
  Cpu,
  Play,
  ShieldCheck,
} from "lucide-react";
import type { GradeData, SubjectData, ChapterData, TopicData } from "./curriculum-explorer";

interface TreeViewProps {
  data: {
    board: { id: number; code: string; name: string };
    grades: GradeData[];
  };
  search: string;
}

// ---------------------------------------------------------------------------
// Search highlighting
// ---------------------------------------------------------------------------
function Highlight({ text, query }: { text: string; query: string }) {
  if (!query || query.length < 2) return <>{text}</>;

  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"));

  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase() ? (
          <mark key={i} className="rounded bg-yellow-200 px-0.5 dark:bg-yellow-800">
            {part}
          </mark>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        )
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Tree View
// ---------------------------------------------------------------------------
export function CurriculumTreeView({ data, search }: TreeViewProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Auto-expand when searching
  const autoExpandKeys = useMemo(() => {
    if (!search || search.length < 2) return new Set<string>();
    const q = search.toLowerCase();
    const keys = new Set<string>();

    for (const grade of data.grades) {
      for (const subject of grade.subjects) {
        let subjectMatches = subject.name.toLowerCase().includes(q) || subject.code.toLowerCase().includes(q);

        for (const chapter of subject.chapters) {
          let chapterMatches = chapter.title.toLowerCase().includes(q);

          for (const topic of chapter.topics) {
            if (topic.title.toLowerCase().includes(q)) {
              chapterMatches = true;
              subjectMatches = true;
            }
          }

          if (chapterMatches) {
            keys.add(`g-${grade.grade}-${grade.stream}`);
            keys.add(`s-${subject.id}`);
            keys.add(`c-${chapter.id}`);
            subjectMatches = true;
          }
        }

        if (subjectMatches) {
          keys.add(`g-${grade.grade}-${grade.stream}`);
          keys.add(`s-${subject.id}`);
        }
      }
    }
    return keys;
  }, [search, data]);

  function isExpanded(key: string): boolean {
    return expanded.has(key) || autoExpandKeys.has(key);
  }

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function matchesSearch(text: string): boolean {
    if (!search || search.length < 2) return true;
    return text.toLowerCase().includes(search.toLowerCase());
  }

  return (
    <div className="space-y-0.5 rounded-lg border bg-card p-2">
      {data.grades.map((grade) => {
        const gradeKey = `g-${grade.grade}-${grade.stream}`;
        const expected = grade.totalSubjects; // Use actual count from DB
        const parsedPct = expected > 0 ? Math.round((grade.subjectsWithChapters / expected) * 100) : 0;
        const hasMissing = grade.subjectsWithChapters < expected;

        // Filter subjects by search
        const visibleSubjects = search.length >= 2
          ? grade.subjects.filter((s) => {
              if (matchesSearch(s.name) || matchesSearch(s.code)) return true;
              return s.chapters.some((c) =>
                matchesSearch(c.title) || c.topics.some((t) => matchesSearch(t.title))
              );
            })
          : grade.subjects;

        if (search.length >= 2 && visibleSubjects.length === 0) return null;

        return (
          <div key={gradeKey}>
            {/* Grade row */}
            <button
              onClick={() => toggle(gradeKey)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted/60"
            >
              {isExpanded(gradeKey) ? (
                <ChevronDown className="size-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="size-4 text-muted-foreground" />
              )}
              <GraduationCap className="size-4 text-violet-500" />
              <span className="text-sm font-medium">
                Class {grade.grade}
                {grade.stream && ` — ${grade.stream}`}
              </span>
              <Badge variant="outline" className="ml-auto text-[10px]">
                {grade.subjectsWithChapters}/{expected} subjects
              </Badge>
              <CompletionBar pct={parsedPct} />
              <span className="text-xs text-muted-foreground">
                {grade.totalChapters} ch · {grade.totalTopics} topics
              </span>
            </button>

            {/* Inline scrape + missing subjects info */}
            {isExpanded(gradeKey) && hasMissing && (
              <div className="ml-8 mb-2 space-y-1.5">
                <div className="flex items-center gap-2">
                  <ScrapeGradeButton boardCode={data.board.code} grade={grade.grade} />
                  <span className="text-[10px] text-amber-600">
                    {expected - grade.subjectsWithChapters} subjects missing chapters
                  </span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {grade.subjects
                    .filter((s) => s.chaptersCount === 0)
                    .map((s) => (
                      <span
                        key={s.id}
                        className="inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                      >
                        {s.name}
                      </span>
                    ))}
                </div>
              </div>
            )}

            {/* Subjects */}
            {isExpanded(gradeKey) && (
              <div className="ml-6 border-l pl-2">
                {visibleSubjects.map((subject) => (
                  <SubjectNode
                    key={subject.id}
                    subject={subject}
                    search={search}
                    isExpanded={isExpanded}
                    toggle={toggle}
                    matchesSearch={matchesSearch}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subject Node
// ---------------------------------------------------------------------------
function SubjectNode({
  subject,
  search,
  isExpanded,
  toggle,
  matchesSearch,
}: {
  subject: SubjectData;
  search: string;
  isExpanded: (key: string) => boolean;
  toggle: (key: string) => void;
  matchesSearch: (text: string) => boolean;
}) {
  const key = `s-${subject.id}`;
  const hasContent = subject.chaptersCount > 0;

  return (
    <div>
      <button
        onClick={() => toggle(key)}
        className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted/60 ${
          !hasContent ? "opacity-50" : ""
        }`}
      >
        {hasContent ? (
          isExpanded(key) ? (
            <ChevronDown className="size-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-3.5 text-muted-foreground" />
          )
        ) : (
          <span className="size-3.5" />
        )}
        <BookOpen className="size-3.5 text-blue-500" />
        <span className="text-sm">
          <Highlight text={subject.name} query={search} />
        </span>
        <Badge variant="secondary" className="text-[10px]">
          {subject.code}
        </Badge>

        <span className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
          {subject.aiModel && (
            <span className="flex items-center gap-1">
              <Cpu className="size-3" />
              {getModelShort(subject.aiModel)}
            </span>
          )}
          {subject.sourcePdf && (
            <a
              href={subject.sourcePdf}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-0.5 text-blue-500 hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              PDF <ExternalLink className="size-2.5" />
            </a>
          )}
          <span>{subject.chaptersCount} ch</span>
          <span>{subject.topicsCount} topics</span>
          {hasContent && (
            <Link
              href={`/curriculum/verify/${subject.id}`}
              className="flex items-center gap-0.5 text-violet-500 hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              <ShieldCheck className="size-2.5" /> Verify
            </Link>
          )}
        </span>
      </button>

      {/* Chapters */}
      {isExpanded(key) && hasContent && (
        <div className="ml-6 border-l pl-2">
          {subject.chapters.map((chapter) => (
            <ChapterNode
              key={chapter.id}
              chapter={chapter}
              search={search}
              isExpanded={isExpanded}
              toggle={toggle}
              matchesSearch={matchesSearch}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chapter Node
// ---------------------------------------------------------------------------
function ChapterNode({
  chapter,
  search,
  isExpanded,
  toggle,
  matchesSearch,
}: {
  chapter: ChapterData;
  search: string;
  isExpanded: (key: string) => boolean;
  toggle: (key: string) => void;
  matchesSearch: (text: string) => boolean;
}) {
  const key = `c-${chapter.id}`;
  const hasTopics = chapter.topicsCount > 0;

  // Filter topics by search
  const visibleTopics = search.length >= 2
    ? chapter.topics.filter((t) => matchesSearch(t.title))
    : chapter.topics;

  return (
    <div>
      <button
        onClick={() => toggle(key)}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-muted/60"
      >
        {hasTopics ? (
          isExpanded(key) ? (
            <ChevronDown className="size-3 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-3 text-muted-foreground" />
          )
        ) : (
          <span className="size-3" />
        )}
        <Layers className="size-3 text-indigo-400" />
        <span className="text-xs font-mono text-muted-foreground w-5">
          {chapter.chapterNumber}.
        </span>
        <span className="text-sm">
          <Highlight text={chapter.title} query={search} />
        </span>

        <span className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
          {chapter.weightagePct && <span>{chapter.weightagePct}%</span>}
          {chapter.estimatedHours && <span>{chapter.estimatedHours}h</span>}
          <span>{chapter.topicsCount} topics</span>
        </span>
      </button>

      {/* Topics */}
      {isExpanded(key) && hasTopics && (
        <div className="ml-6 border-l pl-2">
          {(search.length >= 2 ? visibleTopics : chapter.topics).map((topic) => (
            <TopicRow key={topic.id} topic={topic} search={search} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Topic Row (leaf node)
// ---------------------------------------------------------------------------
function TopicRow({ topic, search }: { topic: TopicData; search: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md px-2 py-0.5 text-left hover:bg-muted/40">
      <FileText className="size-3 text-gray-400" />
      <span className="text-xs">
        <Highlight text={topic.title} query={search} />
      </span>
      {topic.bloomLevel && (
        <Badge variant="outline" className="text-[9px] px-1 py-0">
          {topic.bloomLevel}
        </Badge>
      )}
      {topic.estimatedMinutes && (
        <span className="ml-auto text-[10px] text-muted-foreground">
          {topic.estimatedMinutes}m
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function CompletionBar({ pct }: { pct: number }) {
  const color = pct >= 80 ? "bg-green-500" : pct >= 30 ? "bg-amber-500" : "bg-red-400";
  return (
    <div className="h-1.5 w-12 overflow-hidden rounded-full bg-muted">
      <div
        className={`h-full rounded-full ${color} transition-all`}
        style={{ width: `${Math.min(pct, 100)}%` }}
      />
    </div>
  );
}

function getModelShort(model: string): string {
  if (model.includes("claude")) return "Claude";
  if (model.includes("gemini")) return "Gemini";
  if (model.includes("gpt-4o-mini")) return "GPT-mini";
  if (model.includes("gpt-4o")) return "GPT-4o";
  if (model.includes("mistral")) return "Mistral";
  if (model.includes("sonar")) return "Perplexity";
  return model.slice(0, 12);
}

function ScrapeGradeButton({
  boardCode,
  grade,
}: {
  boardCode: string;
  grade: number;
}) {
  const [scraping, setScraping] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function triggerScrape() {
    setScraping(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/scrape-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          boardCode,
          jobType: "syllabus",
          grades: [grade],
          maxPdfs: 20,
          aiProvider: "auto",
        }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage(`Scrape job #${data.data.id} queued!`);
      } else {
        setMessage(data.error?.message ?? "Failed");
      }
    } catch {
      setMessage("Network error");
    } finally {
      setScraping(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        className="h-6 text-[10px] px-2"
        onClick={triggerScrape}
        disabled={scraping}
      >
        <Play className="mr-1 size-2.5" />
        {scraping ? "Queuing..." : `Scrape Class ${grade}`}
      </Button>
      {message && (
        <span className="text-[10px] text-muted-foreground">{message}</span>
      )}
    </div>
  );
}
