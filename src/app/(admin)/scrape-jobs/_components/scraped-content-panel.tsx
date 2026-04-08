"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  BookOpen,
  Layers,
  FileText,
  GraduationCap,
  Globe,
  Loader2,
  Eye,
} from "lucide-react";

interface ContentTotals {
  total_boards: number;
  total_standards: number;
  total_subjects: number;
  total_chapters: number;
  total_topics: number;
}

interface BoardData {
  board_code: string;
  board_name: string;
  standards_count: number;
  subjects_count: number;
  chapters_count: number;
  topics_count: number;
  grades: number[];
}

interface GradeData {
  board_code: string;
  grade: number;
  stream: string | null;
  subjects_count: number;
  chapters_count: number;
  topics_count: number;
  subject_names: string[];
}

interface RecentChapter {
  id: number;
  title: string;
  chapter_number: number;
  subject_name: string;
  subject_id: number;
  grade: number;
  board_code: string;
  created_at: string;
  topic_count: number;
  source_pdf: string | null;
}

interface ContentData {
  totals: ContentTotals;
  byBoard: BoardData[];
  byGrade: GradeData[];
  recentChapters: RecentChapter[];
}

export function ScrapedContentPanel({ jobTypeFilter: _jobTypeFilter = "all" }: { jobTypeFilter?: string }) {
  const [data, setData] = useState<ContentData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchContent = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/scraped-content");
      const json = await res.json();
      if (json.success) {
        setData(json.data);
      }
    } catch {
      // Silently ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchContent();
  }, [fetchContent]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-8 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Loading content data...
      </div>
    );
  }

  if (!data) {
    return <p className="text-sm text-muted-foreground">Failed to load content data.</p>;
  }

  const t = data.totals;

  return (
    <div className="space-y-6">
      {/* Overall totals */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        <StatCard icon={<Globe className="size-4" />} label="Active Boards" value={t.total_boards} />
        <StatCard icon={<GraduationCap className="size-4" />} label="Standards" value={t.total_standards} />
        <StatCard icon={<BookOpen className="size-4" />} label="Subjects" value={t.total_subjects} />
        <StatCard icon={<Layers className="size-4" />} label="Chapters" value={t.total_chapters} />
        <StatCard icon={<FileText className="size-4" />} label="Topics" value={t.total_topics} />
      </div>

      {/* Per-board breakdown */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Content by Board</CardTitle>
        </CardHeader>
        <CardContent>
          {data.byBoard.length === 0 ? (
            <p className="text-sm text-muted-foreground">No content scraped yet.</p>
          ) : (
            <div className="space-y-4">
              {data.byBoard.map((board) => (
                <div key={board.board_code} className="rounded-lg border p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-medium">{board.board_name}</h3>
                      <p className="text-xs text-muted-foreground">
                        {board.board_code} &middot; Grades:{" "}
                        {board.grades.filter(Boolean).length > 0
                          ? board.grades.filter(Boolean).join(", ")
                          : "None"}
                      </p>
                    </div>
                    <div className="flex gap-6 text-right text-sm">
                      <div>
                        <div className="text-xs text-muted-foreground">Subjects</div>
                        <div className="text-lg font-bold">{board.subjects_count}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">Chapters</div>
                        <div className="text-lg font-bold text-violet-600">{board.chapters_count}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">Topics</div>
                        <div className="text-lg font-bold text-green-600">{board.topics_count}</div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Per-grade detail (only grades with actual chapters) */}
      {data.byGrade.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Content by Grade</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2 pr-4">Board</th>
                    <th className="pb-2 pr-4">Grade</th>
                    <th className="pb-2 pr-4">Stream</th>
                    <th className="pb-2 pr-4">Subjects</th>
                    <th className="pb-2 pr-4">Chapters</th>
                    <th className="pb-2 pr-4">Topics</th>
                    <th className="pb-2">Subjects List</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byGrade.map((row, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-2 pr-4 font-medium">{row.board_code}</td>
                      <td className="py-2 pr-4">Class {row.grade}</td>
                      <td className="py-2 pr-4 text-xs text-muted-foreground">
                        {row.stream ?? "—"}
                      </td>
                      <td className="py-2 pr-4">{row.subjects_count}</td>
                      <td className="py-2 pr-4 font-medium text-violet-600">{row.chapters_count}</td>
                      <td className="py-2 pr-4 font-medium text-green-600">{row.topics_count}</td>
                      <td className="max-w-[300px] truncate py-2 text-xs text-muted-foreground">
                        {row.subject_names.join(", ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recently added chapters */}
      {data.recentChapters.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recently Added Chapters</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2 pr-3">Board</th>
                    <th className="pb-2 pr-3">Grade</th>
                    <th className="pb-2 pr-3">Subject</th>
                    <th className="pb-2 pr-3">Ch#</th>
                    <th className="pb-2 pr-3">Chapter Title</th>
                    <th className="pb-2 pr-3">Topics</th>
                    <th className="pb-2 pr-3">Source</th>
                    <th className="pb-2">Added</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentChapters.map((ch) => (
                    <tr key={ch.id} className="border-b last:border-0">
                      <td className="py-2 pr-3 text-xs">{ch.board_code}</td>
                      <td className="py-2 pr-3 text-xs">Class {ch.grade}</td>
                      <td className="py-2 pr-3 text-xs font-medium">
                        <Link href={`/curriculum?subjectId=${ch.subject_id}`} className="text-violet-600 hover:underline">
                          {ch.subject_name}
                        </Link>
                      </td>
                      <td className="py-2 pr-3 font-mono text-xs">{ch.chapter_number}</td>
                      <td className="max-w-[250px] truncate py-2 pr-3 text-xs">{ch.title}</td>
                      <td className="py-2 pr-3 text-xs font-medium text-green-600">
                        {ch.topic_count}
                      </td>
                      <td className="py-2 pr-3">
                        {ch.source_pdf ? (
                          <a
                            href={`/api/admin/local-pdf?path=${encodeURIComponent(ch.source_pdf)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[10px] text-violet-600 hover:underline"
                          >
                            <Eye className="h-3 w-3" />
                            PDF
                          </a>
                        ) : (
                          <span className="text-[10px] text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="py-2 text-xs text-muted-foreground">
                        {new Date(ch.created_at).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="flex items-start gap-2">
          <span className="mt-0.5 text-muted-foreground">{icon}</span>
          <div>
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="text-lg font-bold">{value}</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
