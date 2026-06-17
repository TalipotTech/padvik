"use client";

import { useState, Fragment } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  BookOpen,
  Layers,
  FileText,
  ExternalLink,
  Cpu,
  Clock,
  ChevronDown,
  ChevronUp,
  ShieldCheck,
} from "lucide-react";
import type { GradeData, SubjectData } from "./curriculum-explorer";

interface GridViewProps {
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
          <mark key={i} className="rounded bg-yellow-200 px-0.5 dark:bg-yellow-800">{part}</mark>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        )
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Grid View
// ---------------------------------------------------------------------------
export function CurriculumGridView({ data, search }: GridViewProps) {
  return (
    <div className="space-y-8">
      {data.grades.map((grade) => {
        const expected = grade.totalSubjects; // Use actual count from DB
        const parsedPct = expected > 0 ? Math.round((grade.subjectsWithChapters / expected) * 100) : 0;

        // Filter by search
        const q = search.toLowerCase();
        const visibleSubjects = search.length >= 2
          ? grade.subjects.filter(
              (s) =>
                s.name.toLowerCase().includes(q) ||
                s.code.toLowerCase().includes(q) ||
                s.chapters.some(
                  (c) =>
                    c.title.toLowerCase().includes(q) ||
                    c.topics.some((t) => t.title.toLowerCase().includes(q))
                )
            )
          : grade.subjects;

        if (search.length >= 2 && visibleSubjects.length === 0) return null;

        return (
          // Key includes academicYear so React treats 2025-26 Class 10 and
          // 2026-27 Class 10 as distinct sections (otherwise the second
          // section would silently drop due to duplicate keys).
          <div key={`${grade.grade}-${grade.stream}-${grade.academicYear}`}>
            {/* Grade header */}
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold">
                  Class {grade.grade}
                  {grade.stream && ` — ${grade.stream}`}
                </h2>
                <span className="rounded bg-violet-100 px-1.5 py-0.5 font-mono text-[11px] text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">
                  {grade.academicYear}
                </span>
                <Badge variant="outline" className="text-xs">
                  {grade.subjectsWithChapters}/{expected} parsed
                </Badge>
              </div>
              <div className="flex items-center gap-2">
                <CompletionRing pct={parsedPct} />
                <span className="text-sm font-medium">{parsedPct}%</span>
              </div>
            </div>

            {/* Subject cards grid */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {visibleSubjects.map((subject) => (
                <SubjectCard
                  key={subject.id}
                  subject={subject}
                  search={search}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subject Card
// ---------------------------------------------------------------------------
function SubjectCard({
  subject,
  search,
}: {
  subject: SubjectData;
  search: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasContent = subject.chaptersCount > 0;
  const borderColor = hasContent
    ? "border-l-green-500"
    : "border-l-gray-300 dark:border-l-gray-600";

  return (
    <Card className={`border-l-4 ${borderColor} transition-shadow hover:shadow-md`}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-sm">
              <Highlight text={subject.name} query={search} />
            </CardTitle>
            <Badge variant="secondary" className="mt-1 text-[10px]">
              {subject.code}
            </Badge>
          </div>
          {subject.maxMarks && (
            <span className="text-xs text-muted-foreground">{subject.maxMarks} marks</span>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {/* Stats row */}
        <div className="flex gap-4 text-xs">
          <span className="flex items-center gap-1">
            <Layers className="size-3 text-violet-500" />
            <strong>{subject.chaptersCount}</strong> chapters
          </span>
          <span className="flex items-center gap-1">
            <FileText className="size-3 text-green-500" />
            <strong>{subject.topicsCount}</strong> topics
          </span>
        </div>

        {/* Source info */}
        {(subject.aiModel || subject.sourcePdf) && (
          <div className="flex flex-wrap gap-2 text-[10px] text-muted-foreground">
            {subject.aiModel && (
              <span className="flex items-center gap-0.5">
                <Cpu className="size-2.5" />
                {getModelShort(subject.aiModel)}
              </span>
            )}
            {subject.parsedAt && (
              <span className="flex items-center gap-0.5">
                <Clock className="size-2.5" />
                {new Date(subject.parsedAt).toLocaleDateString()}
              </span>
            )}
            {subject.sourcePdf && (
              <a
                href={subject.sourcePdf}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-0.5 text-blue-500 hover:underline"
              >
                Source PDF <ExternalLink className="size-2.5" />
              </a>
            )}
          </div>
        )}

        {/* Expandable chapters list */}
        {hasContent && (
          <>
            <Separator />
            <button
              onClick={() => setExpanded(!expanded)}
              className="flex w-full items-center justify-between text-xs text-muted-foreground hover:text-foreground"
            >
              <span>{expanded ? "Hide" : "Show"} chapters</span>
              {expanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
            </button>

            {expanded && (
              <div className="space-y-1.5 pt-1">
                {subject.chapters.map((ch) => (
                  <div key={ch.id} className="rounded bg-muted/50 p-2">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {ch.chapterNumber}.
                      </span>
                      <span className="text-xs font-medium">
                        <Highlight text={ch.title} query={search} />
                      </span>
                      <span className="ml-auto text-[10px] text-muted-foreground">
                        {ch.topicsCount} topics
                      </span>
                    </div>
                    {ch.topics.length > 0 && (
                      <div className="mt-1 ml-4 space-y-0.5">
                        {ch.topics.map((t) => (
                          <div key={t.id} className="flex items-center gap-1 text-[10px] text-muted-foreground">
                            <FileText className="size-2.5" />
                            <Highlight text={t.title} query={search} />
                            {t.bloomLevel && (
                              <Badge variant="outline" className="text-[8px] px-1 py-0 ml-auto">
                                {t.bloomLevel}
                              </Badge>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* Verify link */}
        {hasContent && (
          <Link
            href={`/curriculum/verify/${subject.id}`}
            className="flex items-center gap-1 text-xs text-violet-500 hover:underline"
          >
            <ShieldCheck className="size-3" />
            Verify parsed content
          </Link>
        )}

        {!hasContent && (
          <p className="text-[10px] text-muted-foreground italic">
            Not yet scraped — trigger a scrape to populate
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function CompletionRing({ pct }: { pct: number }) {
  const r = 10;
  const c = 2 * Math.PI * r;
  const fill = c * (pct / 100);
  const color = pct >= 80 ? "#22c55e" : pct >= 30 ? "#f59e0b" : "#ef4444";

  return (
    <svg width="28" height="28" viewBox="0 0 28 28" className="shrink-0">
      <circle cx="14" cy="14" r={r} fill="none" stroke="currentColor" strokeWidth="2.5" className="text-muted" />
      <circle
        cx="14"
        cy="14"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="2.5"
        strokeDasharray={`${fill} ${c - fill}`}
        strokeDashoffset={c * 0.25}
        strokeLinecap="round"
      />
    </svg>
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
