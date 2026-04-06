"use client";

import { useState, useEffect } from "react";
import {
  FileText,
  RefreshCw,
  CheckCircle,
  Loader2,
  AlertCircle,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

interface QuestionPaper {
  id: number;
  boardId: number | null;
  standardId: number | null;
  subjectId: number | null;
  paperTitle: string;
  paperYear: number;
  paperMonth: string | null;
  paperType: string;
  totalMarks: number | null;
  durationMinutes: number | null;
  sourceUrl: string | null;
  parsingStatus: string;
  parsedBy: string | null;
  questionCount: number;
  metadata: Record<string, unknown>;
  createdAt: string;
}

const STATUS_CONFIG: Record<string, { icon: typeof CheckCircle; color: string; label: string }> = {
  pending: { icon: Loader2, color: "bg-gray-100 text-gray-800", label: "Pending" },
  processing: { icon: Loader2, color: "bg-yellow-100 text-yellow-800", label: "Processing" },
  completed: { icon: CheckCircle, color: "bg-green-100 text-green-800", label: "Completed" },
  failed: { icon: AlertCircle, color: "bg-red-100 text-red-800", label: "Failed" },
};

export default function QuestionPapersPage() {
  const [papers, setPapers] = useState<QuestionPaper[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  useEffect(() => {
    fetchPapers();
  }, []);

  const fetchPapers = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/question-papers");
      const body = await res.json();
      if (body.success) {
        setPapers(body.data);
      }
    } catch {
      // Error handled silently
    } finally {
      setLoading(false);
    }
  };

  const totalQuestions = papers.reduce((sum, p) => sum + p.questionCount, 0);
  const completedPapers = papers.filter((p) => p.parsingStatus === "completed").length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Question Papers</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage scraped and uploaded question papers
          </p>
        </div>
        <Button variant="outline" onClick={fetchPapers}>
          <RefreshCw className="h-4 w-4 mr-2" /> Refresh
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-2xl font-bold">{papers.length}</p>
            <p className="text-xs text-muted-foreground">Total Papers</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-2xl font-bold">{completedPapers}</p>
            <p className="text-xs text-muted-foreground">Parsed</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-2xl font-bold">{totalQuestions}</p>
            <p className="text-xs text-muted-foreground">Questions Extracted</p>
          </CardContent>
        </Card>
      </div>

      {/* Papers list */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-full" />)}
        </div>
      ) : papers.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <FileText className="h-10 w-10 mx-auto mb-3 opacity-40" />
            <p>No question papers yet.</p>
            <p className="text-xs mt-1">
              Trigger a question paper scrape from the Scrape Jobs page, or upload papers manually.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {papers.map((paper) => {
            const statusConfig = STATUS_CONFIG[paper.parsingStatus] ?? STATUS_CONFIG.pending;
            const StatusIcon = statusConfig.icon;
            const isExpanded = expandedId === paper.id;

            return (
              <Card key={paper.id}>
                <CardContent className="pt-4 pb-3">
                  <div
                    className="flex items-center gap-3 cursor-pointer"
                    onClick={() => setExpandedId(isExpanded ? null : paper.id)}
                  >
                    <FileText className="h-5 w-5 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {paper.paperTitle}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge variant="outline" className="text-xs">
                          {paper.paperYear}
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                          {paper.paperType}
                        </Badge>
                        {paper.totalMarks && (
                          <span className="text-xs text-muted-foreground">
                            {paper.totalMarks} marks
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <Badge className={`text-xs gap-1 ${statusConfig.color}`}>
                        <StatusIcon className={`h-3 w-3 ${paper.parsingStatus === "processing" ? "animate-spin" : ""}`} />
                        {statusConfig.label}
                      </Badge>
                      <span className="text-sm font-medium">
                        {paper.questionCount} Q
                      </span>
                      {isExpanded ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="mt-3 pt-3 border-t text-sm space-y-2">
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <span className="text-muted-foreground">Parsed by:</span>{" "}
                          {paper.parsedBy ?? "N/A"}
                        </div>
                        <div>
                          <span className="text-muted-foreground">Duration:</span>{" "}
                          {paper.durationMinutes ? `${paper.durationMinutes} min` : "N/A"}
                        </div>
                        <div>
                          <span className="text-muted-foreground">Source:</span>{" "}
                          {paper.sourceUrl ? (
                            <a
                              href={paper.sourceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-violet-600 hover:underline"
                            >
                              View source
                            </a>
                          ) : (
                            "N/A"
                          )}
                        </div>
                        <div>
                          <span className="text-muted-foreground">Created:</span>{" "}
                          {new Date(paper.createdAt).toLocaleDateString()}
                        </div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
