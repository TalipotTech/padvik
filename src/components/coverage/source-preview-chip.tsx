/**
 * SourcePreviewChip — dual-source availability banner (NCERT + CBSE textbook)
 * above the Coverage action bar. Extracted from /admin/coverage so the
 * dashboard's /dashboard/syllabus page can show admins the exact same
 * pre-flight info when they're deciding between Bootstrap NCERT vs Fill Gaps.
 *
 * Pure presentation — pass in a `SourcePreview` as returned by
 *   GET /api/admin/coverage/source-preview?grade=…&subjectId=…[&academicYear=…]
 * and it renders the two-column NCERT | CBSE summary + recommendation line.
 */
"use client";

import { AlertTriangle, CheckCircle2 } from "lucide-react";

export type RecommendedSourceAction =
  | "generate_from_cbse"
  | "bootstrap_ncert"
  | "upload_manual"
  | "none";

export interface SourcePreview {
  grade: number;
  subject: string;
  subjectId: number | null;
  ncert: {
    available: boolean;
    books: Array<{ code: string; name: string; chapters: number; language: string }>;
    totalChapters: number;
  };
  cbseTextbook: {
    available: boolean;
    sourcePdf: string | null;
    sourceUrl: string | null;
    parsedAt: string | null;
    parsedChapters: number;
    totalTopics: number;
    topicsWithContent: number;
    topicsMissing: number;
  };
  recommendedAction: RecommendedSourceAction;
  message: string;
  suggestions: string[];
  looksLikeSkillSubject: boolean;
  /**
   * Academic year the recommendation applies to — either the page's pinned
   * selection or the subject's own standards row. Null only for legacy rows
   * that predate the NOT NULL migration.
   */
  academicYear: string | null;
}

export function SourcePreviewChip({ preview }: { preview: SourcePreview }) {
  const { ncert, cbseTextbook, recommendedAction, message, suggestions } = preview;

  // Tone is driven by the recommendation: green when we have a clear path
  // forward, amber when the admin needs to intervene manually, grey when
  // nothing is actionable (everything covered).
  const tone: "ok" | "warn" | "neutral" =
    recommendedAction === "upload_manual"
      ? "warn"
      : recommendedAction === "none"
      ? "neutral"
      : "ok";

  const toneClass =
    tone === "ok"
      ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-900"
      : tone === "warn"
      ? "border-amber-500/20 bg-amber-500/5 text-amber-900"
      : "border-slate-500/20 bg-slate-500/5 text-slate-800";

  return (
    <div className={`rounded-md border p-3 text-xs ${toneClass}`}>
      <div className="flex items-start gap-2">
        {tone === "ok" ? (
          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        ) : (
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        )}
        <div className="flex-1 space-y-2">
          {/* Side-by-side NCERT | CBSE summary */}
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded border border-background/60 bg-background/60 p-2">
              <div className="flex items-center gap-1.5 font-medium">
                {ncert.available ? (
                  <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                ) : (
                  <AlertTriangle className="h-3 w-3 text-amber-600" />
                )}
                NCERT
              </div>
              <div className="mt-0.5 opacity-90">
                {ncert.available
                  ? `${ncert.books.length} book(s) · ${ncert.totalChapters} chapter(s)`
                  : "No matching textbook"}
              </div>
              {ncert.available && ncert.books.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {ncert.books.map((b) => (
                    <span
                      key={b.code}
                      className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]"
                    >
                      {b.code} · {b.chapters}ch
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded border border-background/60 bg-background/60 p-2">
              <div className="flex items-center gap-1.5 font-medium">
                {cbseTextbook.available ? (
                  <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                ) : (
                  <AlertTriangle className="h-3 w-3 text-amber-600" />
                )}
                CBSE textbook PDF
              </div>
              <div className="mt-0.5 opacity-90">
                {cbseTextbook.available
                  ? `Scraped · ${cbseTextbook.parsedChapters} chapter(s) · ${cbseTextbook.totalTopics} topic(s)`
                  : "Not scraped yet"}
              </div>
              {cbseTextbook.available && (
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] opacity-80">
                  <span>
                    <span className="font-mono">{cbseTextbook.topicsWithContent}</span> with content
                  </span>
                  <span>·</span>
                  <span>
                    <span className="font-mono">{cbseTextbook.topicsMissing}</span> missing
                  </span>
                  {cbseTextbook.sourcePdf && (
                    <span className="block w-full truncate font-mono text-[10px] opacity-70">
                      {cbseTextbook.sourcePdf}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Recommendation line */}
          <div>
            <span className="font-medium">Recommended:</span> {message}
          </div>

          {suggestions.length > 0 && (
            <ul className="list-disc pl-4 opacity-90">
              {suggestions.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
