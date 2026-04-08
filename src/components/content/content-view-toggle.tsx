"use client";

import { useState } from "react";
import { MarkdownRenderer } from "@/components/content/markdown-renderer";
import { PdfViewer } from "@/components/content/pdf-viewer";
import { cn } from "@/lib/utils";
import { FileText, BookOpen } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ContentItem {
  id: number;
  title: string;
  body: string;
  contentType: string;
  sourceType: string;
  sourceUrl?: string | null;
  metadata: Record<string, unknown> | null;
}

interface ContentViewToggleProps {
  content: ContentItem;
  className?: string;
  /** Callback when user asks AI in the Book view — receives optional question text */
  onAskAI?: (question?: string) => void;
}

// ---------------------------------------------------------------------------
// PDF URL Resolution
// ---------------------------------------------------------------------------

function resolvePdfUrl(content: ContentItem): string | null {
  // Check metadata.pdfPath first (set by scraper/enrichment — local disk path)
  const pdfPath = content.metadata?.pdfPath as string | undefined;
  // Then metadata.sourcePdf (set by syllabus inserter during scraping)
  const sourcePdf = content.metadata?.sourcePdf as string | undefined;
  // Then extraction metadata
  const extractionPath = (content.metadata?.extraction as Record<string, unknown>)?.pdfPath as string | undefined;
  // Then the content item's own sourceUrl (top-level DB field — may be remote URL)
  const contentSourceUrl = content.sourceUrl ?? undefined;

  const candidate = pdfPath ?? sourcePdf ?? extractionPath ?? contentSourceUrl;
  if (!candidate) return null;

  // Skip non-PDF URLs
  if (!candidate.includes(".pdf") && !candidate.includes("/pdfs/")) return null;

  // Already an API URL
  if (candidate.startsWith("/api/pdfs/")) return candidate;

  // Remote NCERT URL → map to local pdf-cache path
  // The enrichment script downloads these to data/pdf-cache/{contentId}-{filename}.pdf
  if (candidate.startsWith("http://") || candidate.startsWith("https://")) {
    try {
      const url = new URL(candidate);
      const filename = url.pathname.split("/").pop();
      if (filename?.endsWith(".pdf")) {
        // Try the cached version: /api/pdfs/{contentId}-{filename}
        return `/api/pdfs/${content.id}-${filename}`;
      }
    } catch { /* invalid URL */ }
    return null;
  }

  // Local path: data/pdfs/... or data/pdf-cache/... or data/ncert-pdfs/...
  // Strip file:// prefix if present
  let localPath = candidate.replace(/^file:\/\//, "");

  // Handle absolute Windows paths — extract relative part
  const dataIdx = localPath.indexOf("data/");
  if (dataIdx >= 0) {
    localPath = localPath.substring(dataIdx);
  } else if (localPath.replace(/\\/g, "/").includes("data\\")) {
    const winIdx = localPath.replace(/\\/g, "/").indexOf("data/");
    if (winIdx >= 0) localPath = localPath.substring(winIdx);
  }

  // Normalize to forward slashes
  localPath = localPath.replace(/\\/g, "/");

  // Map to the API route — strip the prefix directory name since the API tries all
  if (localPath.startsWith("data/pdfs/")) {
    return `/api/pdfs/${localPath.substring("data/pdfs/".length)}`;
  }
  if (localPath.startsWith("data/pdf-cache/")) {
    return `/api/pdfs/${localPath.substring("data/pdf-cache/".length)}`;
  }
  if (localPath.startsWith("data/ncert-pdfs/")) {
    return `/api/pdfs/${localPath.substring("data/ncert-pdfs/".length)}`;
  }

  // Fallback: try the path as-is
  return `/api/pdfs/${localPath.replace(/^data\//, "")}`;
}

// ---------------------------------------------------------------------------
// Content View Toggle
// ---------------------------------------------------------------------------
// Priority: Book view (PDF) > Text view (markdown)
// If a PDF source is available, show Book | Text toggle with Book as default.
// If no PDF, render MarkdownRenderer directly (backward compatible).

export function ContentViewToggle({ content, className, onAskAI }: ContentViewToggleProps) {
  const pdfUrl = resolvePdfUrl(content);
  const hasPdf = !!pdfUrl;

  const [view, setView] = useState<"book" | "text">(hasPdf ? "book" : "text");

  // No PDF available — just render markdown (most common case, backward compatible)
  if (!hasPdf) {
    return <MarkdownRenderer content={content.body} className={className} />;
  }

  return (
    <div className={className}>
      {/* View Toggle */}
      <div className="flex items-center gap-1 mb-3 p-1 bg-muted rounded-lg w-fit">
        <button
          onClick={() => setView("book")}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
            view === "book"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <BookOpen className="h-3.5 w-3.5" />
          Book
        </button>
        <button
          onClick={() => setView("text")}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
            view === "text"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <FileText className="h-3.5 w-3.5" />
          Text
        </button>
      </div>

      {/* Content */}
      {view === "book" ? (
        <PdfViewer pdfUrl={pdfUrl} title={content.title} onAskAI={onAskAI} />
      ) : (
        <MarkdownRenderer content={content.body} />
      )}
    </div>
  );
}
