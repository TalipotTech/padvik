"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  FileText,
  Eye,
  EyeOff,
  Loader2,
  BookOpen,
  ExternalLink,
  X,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  AlertTriangle,
  Circle,
  Sparkles,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProcessedPdf {
  subject_id: number;
  subject_name: string;
  subject_code: string;
  board_code: string;
  board_name: string;
  grade: number;
  stream: string | null;
  pdf_path: string | null;
  text_path: string | null;
  source_url: string | null;
  ai_model: string | null;
  scrape_job_id: number | null;
  review_status: string | null;
  parsed_at: string | null;
  chapter_count: number;
  topic_count: number;
  content_count: number;
  question_count: number;
}

interface PdfSummary {
  board_code: string;
  grade: number;
  pdf_count: number;
  total_chapters: number;
  total_topics: number;
  total_content: number;
  total_questions: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PdfBrowserPanel() {
  const [pdfs, setPdfs] = useState<ProcessedPdf[]>([]);
  const [summary, setSummary] = useState<PdfSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [boardFilter, setBoardFilter] = useState("all");
  const [gradeFilter, setGradeFilter] = useState("all");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [textPreview, setTextPreview] = useState<{ path: string; content: string } | null>(null);
  const [textLoading, setTextLoading] = useState(false);

  const fetchPdfs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (boardFilter !== "all") params.set("boardCode", boardFilter);
      if (gradeFilter !== "all") params.set("grade", gradeFilter);
      const res = await fetch(`/api/admin/processed-pdfs?${params}`);
      const json = await res.json();
      if (json.success) {
        setPdfs(json.data.pdfs);
        setSummary(json.data.summary);
      }
    } catch (err) {
      console.error("Failed to fetch PDFs:", err);
    } finally {
      setLoading(false);
    }
  }, [boardFilter, gradeFilter]);

  useEffect(() => { fetchPdfs(); }, [fetchPdfs]);

  const boards = [...new Set(pdfs.map((p) => p.board_code))];
  const grades = [...new Set(pdfs.map((p) => p.grade))].sort((a, b) => a - b);

  async function loadTextPreview(textPath: string) {
    setTextLoading(true);
    try {
      const res = await fetch(`/api/admin/local-pdf?path=${encodeURIComponent(textPath)}`);
      if (res.ok) {
        const text = await res.text();
        setTextPreview({ path: textPath, content: text });
      }
    } catch { /* silently fail */ } finally {
      setTextLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-8 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading processed PDFs...
      </div>
    );
  }

  // Compute overall stats
  const totalSubjects = pdfs.length;
  const totalChapters = pdfs.reduce((s, p) => s + p.chapter_count, 0);
  const totalTopics = pdfs.reduce((s, p) => s + p.topic_count, 0);
  const totalContent = pdfs.reduce((s, p) => s + p.content_count, 0);
  const totalQuestions = pdfs.reduce((s, p) => s + p.question_count, 0);
  const subjectsWithContent = pdfs.filter((p) => p.content_count > 0).length;

  return (
    <div className="space-y-6">
      {/* Overall status banner */}
      <Card className="border-violet-200 bg-violet-50/50 dark:border-violet-800 dark:bg-violet-950/20">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 className="font-semibold text-sm">What was downloaded &amp; processed</h3>
              <p className="text-xs text-muted-foreground mt-1">
                The scraper downloaded {totalSubjects} syllabus PDFs and extracted the curriculum structure (chapters &amp; topics) from each.
                Click any row below to see exactly what was extracted.
              </p>
            </div>
            <div className="flex gap-6 text-center">
              <div>
                <div className="text-2xl font-bold text-violet-600">{totalSubjects}</div>
                <div className="text-[10px] text-muted-foreground">PDFs Processed</div>
              </div>
              <div>
                <div className="text-2xl font-bold">{totalChapters}</div>
                <div className="text-[10px] text-muted-foreground">Chapters Found</div>
              </div>
              <div>
                <div className="text-2xl font-bold">{totalTopics}</div>
                <div className="text-[10px] text-muted-foreground">Topics Found</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-amber-600">{totalContent}</div>
                <div className="text-[10px] text-muted-foreground">Content Items</div>
              </div>
            </div>
          </div>
          {totalContent === 0 && totalSubjects > 0 && (
            <div className="mt-3 flex items-center gap-2 rounded-lg bg-amber-100 px-3 py-2 text-xs dark:bg-amber-900/30">
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
              <span>
                <strong>Syllabus structure extracted, study content not yet generated.</strong>{" "}
                The scraper parsed chapter/topic names from the PDFs. To generate actual study notes and flashcards,
                use the <strong>AI Content Generator</strong> (Jobs tab → Job Type: &quot;AI Content Generator&quot;).
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Summary cards per board/grade */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {summary.map((s) => (
          <Card
            key={`${s.board_code}-${s.grade}`}
            className="cursor-pointer hover:border-violet-300 transition-colors"
            onClick={() => { setBoardFilter(s.board_code); setGradeFilter(String(s.grade)); }}
          >
            <CardContent className="p-3">
              <div className="text-xs font-medium">{s.board_code} · Class {s.grade}</div>
              <div className="mt-1 text-lg font-bold">{s.pdf_count} <span className="text-xs font-normal text-muted-foreground">subjects</span></div>
              <div className="mt-1 space-y-0.5">
                <StatusLine ok={s.total_chapters > 0} text={`${s.total_chapters} chapters · ${s.total_topics} topics`} />
                <StatusLine ok={s.total_content > 0} warn={s.total_content === 0 && s.total_chapters > 0} text={s.total_content > 0 ? `${s.total_content} content items` : "No content — needs generation"} />
                <StatusLine ok={s.total_questions > 0} text={s.total_questions > 0 ? `${s.total_questions} questions` : "No questions"} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={boardFilter} onValueChange={setBoardFilter}>
          <SelectTrigger className="w-[140px] h-8 text-xs"><SelectValue placeholder="All Boards" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Boards</SelectItem>
            {boards.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={gradeFilter} onValueChange={setGradeFilter}>
          <SelectTrigger className="w-[120px] h-8 text-xs"><SelectValue placeholder="All Grades" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Grades</SelectItem>
            {grades.map((g) => <SelectItem key={g} value={String(g)}>Class {g}</SelectItem>)}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">{pdfs.length} subjects shown</span>
        {(boardFilter !== "all" || gradeFilter !== "all") && (
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setBoardFilter("all"); setGradeFilter("all"); }}>
            Clear filters
          </Button>
        )}
      </div>

      {/* PDF preview */}
      {previewPath && (
        <Card className="border-violet-200 dark:border-violet-800">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm">PDF Preview — {previewPath.split("/").pop()}</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => setPreviewPath(null)}><X className="h-4 w-4" /></Button>
          </CardHeader>
          <CardContent className="p-0">
            <iframe src={`/api/admin/local-pdf?path=${encodeURIComponent(previewPath)}`} className="h-[600px] w-full rounded-b-lg border-t" title="PDF Preview" />
          </CardContent>
        </Card>
      )}

      {/* Extracted text preview */}
      {textPreview && (
        <Card className="border-blue-200 dark:border-blue-800">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm">Extracted Text — {textPreview.path.split("/").pop()}</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => setTextPreview(null)}><X className="h-4 w-4" /></Button>
          </CardHeader>
          <CardContent>
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-4 text-xs leading-relaxed">
              {textPreview.content.slice(0, 10000)}
              {textPreview.content.length > 10000 && "\n\n... (truncated)"}
            </pre>
          </CardContent>
        </Card>
      )}

      {/* Subject list — expandable rows */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Processed Subjects</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {pdfs.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No processed PDFs found.</p>
          ) : (
            <div className="divide-y">
              {pdfs.map((pdf) => {
                const isExpanded = expandedId === pdf.subject_id;
                return (
                  <div key={pdf.subject_id}>
                    {/* Row header — clickable */}
                    <div
                      className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors"
                      onClick={() => setExpandedId(isExpanded ? null : pdf.subject_id)}
                    >
                      {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}

                      {/* Subject name + code */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm truncate">{pdf.subject_name}</span>
                          <Badge variant="secondary" className="text-[10px] shrink-0">{pdf.subject_code}</Badge>
                        </div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          {pdf.board_code} · Class {pdf.grade}
                          {pdf.ai_model && <> · AI: {pdf.ai_model.replace("claude-sonnet-4-20250514", "Claude 4").replace("gemini-2.5-flash", "Gemini Flash").replace("gemini-2.5-pro", "Gemini Pro")}</>}
                        </div>
                      </div>

                      {/* Quick stats */}
                      <div className="flex items-center gap-4 shrink-0 text-xs">
                        <div className="text-center">
                          <div className="font-bold text-violet-600">{pdf.chapter_count}</div>
                          <div className="text-[9px] text-muted-foreground">chapters</div>
                        </div>
                        <div className="text-center">
                          <div className="font-bold text-emerald-600">{pdf.topic_count}</div>
                          <div className="text-[9px] text-muted-foreground">topics</div>
                        </div>
                        <div className="text-center">
                          <div className={`font-bold ${pdf.content_count > 0 ? "text-blue-600" : "text-amber-500"}`}>{pdf.content_count}</div>
                          <div className="text-[9px] text-muted-foreground">content</div>
                        </div>
                        <div className="text-center">
                          <div className="font-bold">{pdf.question_count}</div>
                          <div className="text-[9px] text-muted-foreground">questions</div>
                        </div>
                      </div>

                      {/* Pipeline status badges */}
                      <div className="flex items-center gap-1.5 shrink-0">
                        <StatusDot ok={pdf.chapter_count > 0} title="Syllabus parsed" />
                        <StatusDot ok={pdf.content_count > 0} warn={pdf.content_count === 0 && pdf.chapter_count > 0} title={pdf.content_count > 0 ? "Has content" : "Needs content generation"} />
                        <StatusDot ok={pdf.question_count > 0} title={pdf.question_count > 0 ? "Has questions" : "No questions"} />
                      </div>
                    </div>

                    {/* Expanded detail */}
                    {isExpanded && (
                      <div className="border-t bg-muted/20 px-4 py-3">
                        {/* Action buttons */}
                        <div className="flex flex-wrap gap-2 mb-3">
                          {pdf.pdf_path && (
                            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={(e) => { e.stopPropagation(); setPreviewPath(previewPath === pdf.pdf_path ? null : pdf.pdf_path!); }}>
                              <Eye className="mr-1 h-3 w-3" /> View Source PDF
                            </Button>
                          )}
                          {pdf.text_path && (
                            <Button variant="outline" size="sm" className="h-7 text-xs" disabled={textLoading} onClick={(e) => { e.stopPropagation(); textPreview?.path === pdf.text_path ? setTextPreview(null) : loadTextPreview(pdf.text_path!); }}>
                              <FileText className="mr-1 h-3 w-3" /> View Extracted Text
                            </Button>
                          )}
                          <Link href={`/curriculum?subjectId=${pdf.subject_id}`}>
                            <Button variant="outline" size="sm" className="h-7 text-xs">
                              <BookOpen className="mr-1 h-3 w-3" /> View in Curriculum
                            </Button>
                          </Link>
                          {pdf.source_url && (
                            <a href={pdf.source_url} target="_blank" rel="noopener noreferrer">
                              <Button variant="ghost" size="sm" className="h-7 text-xs">
                                <ExternalLink className="mr-1 h-3 w-3" /> Original URL
                              </Button>
                            </a>
                          )}
                        </div>

                        {/* Pipeline status detail */}
                        <div className="rounded-lg border bg-background p-3 space-y-2">
                          <div className="text-xs font-medium mb-2">Pipeline Status</div>

                          <div className="flex items-start gap-2">
                            <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
                            <div>
                              <div className="text-xs font-medium">PDF Downloaded &amp; Text Extracted</div>
                              <div className="text-[10px] text-muted-foreground">
                                Saved to: {pdf.pdf_path ?? "unknown"} | Text: {pdf.text_path ?? "unknown"}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-start gap-2">
                            <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
                            <div>
                              <div className="text-xs font-medium">Syllabus Structure Parsed</div>
                              <div className="text-[10px] text-muted-foreground">
                                AI extracted {pdf.chapter_count} chapters and {pdf.topic_count} topics from the PDF
                              </div>
                            </div>
                          </div>

                          <div className="flex items-start gap-2">
                            {pdf.content_count > 0 ? (
                              <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
                            ) : (
                              <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                            )}
                            <div>
                              <div className="text-xs font-medium">
                                {pdf.content_count > 0
                                  ? `Study Content Generated (${pdf.content_count} items)`
                                  : "Study Content — Not Yet Generated"}
                              </div>
                              <div className="text-[10px] text-muted-foreground">
                                {pdf.content_count > 0
                                  ? "Notes, flashcards, or summaries have been created for topics in this subject"
                                  : "Run the AI Content Generator to create study notes and flashcards from the parsed syllabus"}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-start gap-2">
                            {pdf.question_count > 0 ? (
                              <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
                            ) : (
                              <Circle className="h-4 w-4 text-gray-400 mt-0.5 shrink-0" />
                            )}
                            <div>
                              <div className="text-xs font-medium">
                                {pdf.question_count > 0
                                  ? `Questions Available (${pdf.question_count})`
                                  : "Questions — None Yet"}
                              </div>
                              <div className="text-[10px] text-muted-foreground">
                                {pdf.question_count > 0
                                  ? "MCQs, short answers, or long answers linked to this subject"
                                  : "Questions can be generated via AI Content Generator or scraped from question papers"}
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Metadata */}
                        {pdf.parsed_at && (
                          <div className="mt-2 text-[10px] text-muted-foreground">
                            Parsed: {new Date(pdf.parsed_at).toLocaleString()}
                            {pdf.scrape_job_id && <> · Job #{pdf.scrape_job_id}</>}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusLine({ ok, warn, text }: { ok: boolean; warn?: boolean; text: string }) {
  return (
    <div className="flex items-center gap-1">
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${ok ? "bg-emerald-500" : warn ? "bg-amber-500" : "bg-gray-400"}`} />
      <span className="text-[10px] text-muted-foreground">{text}</span>
    </div>
  );
}

function StatusDot({ ok, warn, title }: { ok: boolean; warn?: boolean; title: string }) {
  return (
    <span
      className={`inline-block h-2.5 w-2.5 rounded-full ${ok ? "bg-emerald-500" : warn ? "bg-amber-500 animate-pulse" : "bg-gray-300"}`}
      title={title}
    />
  );
}
