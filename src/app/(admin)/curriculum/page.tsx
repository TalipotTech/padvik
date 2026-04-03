"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { FileText, Play } from "lucide-react";
import { CurriculumExplorer } from "./_components/curriculum-explorer";

export default function CurriculumPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Curriculum Explorer</h1>
          <p className="text-muted-foreground">
            Browse all scraped syllabus content — boards, grades, subjects, chapters, and topics.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/syllabus-viewer">
            <Button variant="outline" size="sm">
              <FileText className="mr-1.5 size-4" />
              Syllabus Viewer
            </Button>
          </Link>
          <Link href="/scrape-jobs">
            <Button variant="outline" size="sm">
              <Play className="mr-1.5 size-4" />
              Scrape Pipeline
            </Button>
          </Link>
        </div>
      </div>
      <CurriculumExplorer />
    </div>
  );
}
