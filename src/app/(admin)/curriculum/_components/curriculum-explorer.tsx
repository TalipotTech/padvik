"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Search,
  TreePine,
  LayoutGrid,
  Globe,
  BookOpen,
  Layers,
  FileText,
  Loader2,
  GraduationCap,
} from "lucide-react";
import { CurriculumTreeView } from "./curriculum-tree-view";
import { CurriculumGridView } from "./curriculum-grid-view";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface TopicData {
  id: number;
  title: string;
  description: string | null;
  bloomLevel: string | null;
  estimatedMinutes: number | null;
  sortOrder: number;
}

export interface ChapterData {
  id: number;
  chapterNumber: number;
  title: string;
  description: string | null;
  estimatedHours: string | null;
  weightagePct: string | null;
  sortOrder: number;
  topicsCount: number;
  topics: TopicData[];
}

export interface SubjectData {
  id: number;
  name: string;
  code: string;
  maxMarks: number | null;
  subjectType: string;
  chaptersCount: number;
  topicsCount: number;
  sourcePdf: string | null;
  aiModel: string | null;
  parsedAt: string | null;
  chapters: ChapterData[];
}

export interface GradeData {
  standardId: number;
  grade: number;
  stream: string | null;
  totalSubjects: number;
  subjectsWithChapters: number;
  totalChapters: number;
  totalTopics: number;
  subjects: SubjectData[];
}

interface ExplorerData {
  board: { id: number; code: string; name: string };
  grades: GradeData[];
  totals: {
    grades: number;
    subjects: number;
    subjectsWithContent: number;
    chapters: number;
    topics: number;
  };
}

const BOARDS = [
  { code: "CBSE", label: "CBSE" },
  { code: "ICSE", label: "ICSE" },
  { code: "KL_SCERT", label: "Kerala SCERT" },
];

/**
 * Get the "expected" count for a grade — uses the ACTUAL total subjects in DB
 * (not a hardcoded guess). The GradeData.totalSubjects is the real count.
 */
export function getExpectedSubjects(_boardCode: string, _grade: number, gradeData?: GradeData): number {
  // Use actual total from the API response
  if (gradeData) return gradeData.totalSubjects;
  return 0;
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------
export function CurriculumExplorer() {
  const [data, setData] = useState<ExplorerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [boardCode, setBoardCode] = useState("CBSE");
  const [gradeFilter, setGradeFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<"tree" | "grid">("tree");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ boardCode });
      if (gradeFilter !== "all") params.set("grade", gradeFilter);
      const res = await fetch(`/api/admin/curriculum-explorer?${params}`);
      const json = await res.json();
      if (json.success) {
        setData(json.data);
      }
    } catch {
      console.error("Failed to load curriculum data");
    } finally {
      setLoading(false);
    }
  }, [boardCode, gradeFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const t = data?.totals;

  // Calculate overall completeness (subjects with chapters / total subjects)
  let totalExpected = 0;
  let totalParsed = 0;
  if (data) {
    for (const g of data.grades) {
      totalExpected += g.totalSubjects;
      totalParsed += g.subjectsWithChapters;
    }
  }
  const overallPct = totalExpected > 0 ? Math.round((totalParsed / totalExpected) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* Filter bar */}
      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1.5">
          <Label className="text-xs">Board</Label>
          <Select value={boardCode} onValueChange={setBoardCode}>
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BOARDS.map((b) => (
                <SelectItem key={b.code} value={b.code}>
                  {b.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Grade</Label>
          <Select value={gradeFilter} onValueChange={setGradeFilter}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Grades</SelectItem>
              {Array.from({ length: 12 }, (_, i) => (
                <SelectItem key={i + 1} value={String(i + 1)}>
                  Class {i + 1}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex-1 min-w-[200px] space-y-1.5">
          <Label className="text-xs">Search</Label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search subjects, chapters, topics..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        <div className="flex gap-1 border rounded-md p-0.5">
          <Button
            variant={viewMode === "tree" ? "default" : "ghost"}
            size="icon"
            className="size-8"
            onClick={() => setViewMode("tree")}
            title="Tree View"
          >
            <TreePine className="size-4" />
          </Button>
          <Button
            variant={viewMode === "grid" ? "default" : "ghost"}
            size="icon"
            className="size-8"
            onClick={() => setViewMode("grid")}
            title="Grid View"
          >
            <LayoutGrid className="size-4" />
          </Button>
        </div>
      </div>

      {/* Summary stats */}
      {data && t && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
          <MiniStat icon={<Globe className="size-3.5" />} label="Board" value={data.board.name} />
          <MiniStat icon={<GraduationCap className="size-3.5" />} label="Grades" value={t.grades} />
          <MiniStat icon={<BookOpen className="size-3.5" />} label="Subjects" value={`${t.subjectsWithContent}/${t.subjects}`} />
          <MiniStat icon={<Layers className="size-3.5" />} label="Chapters" value={t.chapters} />
          <MiniStat icon={<FileText className="size-3.5" />} label="Topics" value={t.topics} />
          <MiniStat
            icon={<div className={`size-3.5 rounded-full ${overallPct >= 80 ? "bg-green-500" : overallPct >= 30 ? "bg-amber-500" : "bg-red-500"}`} />}
            label="Parsed"
            value={`${overallPct}%`}
          />
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
          Loading curriculum data...
        </div>
      ) : !data || data.grades.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Globe className="mx-auto mb-3 size-10 opacity-30" />
            <p className="text-lg font-medium">No curriculum data found</p>
            <p className="mt-1 text-sm">
              Run a scrape from the Scrape Pipeline page to populate content.
            </p>
          </CardContent>
        </Card>
      ) : viewMode === "tree" ? (
        <CurriculumTreeView
          data={data}
          search={search}
        />
      ) : (
        <CurriculumGridView
          data={data}
          search={search}
        />
      )}
    </div>
  );
}

function MiniStat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border bg-card p-2.5">
      <span className="text-muted-foreground">{icon}</span>
      <div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="text-sm font-bold">{value}</div>
      </div>
    </div>
  );
}
