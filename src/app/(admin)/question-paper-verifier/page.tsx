"use client";

import { PaperVerifier } from "./_components/paper-verifier";

export default function QuestionPaperVerifierPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Question Paper Verifier</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Verify parsed questions against original PDF — select a paper to view its questions
        </p>
      </div>
      <PaperVerifier />
    </div>
  );
}
