"use client";

import { useState } from "react";
import { Share2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useData } from "@/hooks/use-data";
import { apiFetch } from "@/lib/api-client";
import { QuestionCard } from "./question-card";

interface SharedItem {
  shareId: number;
  permission: string;
  sharedAt: string;
  sharedBy: { name: string; email: string };
  question: {
    id: number;
    questionType: string;
    difficulty: string;
    questionText: string;
    options: { label: string; text: string; isCorrect?: boolean }[] | null;
    correctAnswer: string | null;
    solution: string | null;
    marks: string;
    sectionLabel: string | null;
    sourceType: string;
    tags: string[];
    createdAt: string;
    createdBy: number | null;
  };
}

interface SharedResponse {
  items: SharedItem[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export function SharedQuestionsPanel() {
  const [page, setPage] = useState(1);

  const { data, loading } = useData<SharedResponse>(
    () => apiFetch<SharedResponse>(`/api/questions/shared?page=${page}&limit=20`),
    [page]
  );

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-32 w-full" />)}
      </div>
    );
  }

  if (!data || data.items.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          <Share2 className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <p>No questions have been shared with you yet.</p>
          <p className="text-xs mt-1">
            When someone shares questions with you, they will appear here.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {data.items.map((item) => (
        <div key={item.shareId} className="space-y-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground px-1">
            <span>
              Shared by <strong>{item.sharedBy.name}</strong>
            </span>
            <Badge variant="outline" className="text-xs">
              {item.permission === "copy" ? "View & Copy" : "View only"}
            </Badge>
            <span className="ml-auto">
              {new Date(item.sharedAt).toLocaleDateString()}
            </span>
          </div>
          <QuestionCard question={item.question} />
        </div>
      ))}

      {data.pagination.totalPages > 1 && (
        <div className="flex justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= data.pagination.totalPages}
            onClick={() => setPage(page + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
