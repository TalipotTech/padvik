"use client";

import { QuestionViewer } from "./_components/question-viewer";

export default function QuestionViewerPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Question Viewer</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Browse scraped and uploaded questions by Board, Grade, Subject, Chapter, and Topic
        </p>
      </div>
      <QuestionViewer />
    </div>
  );
}
