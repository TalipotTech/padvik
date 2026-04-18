"use client";

import { useEffect, useState, useRef } from "react";
import { Maximize2, Minimize2, Download, ExternalLink, Sparkles, Send, X, ClipboardPaste, BookOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

interface PdfViewerProps {
  /** URL to the PDF file (served via /api/pdfs/...) */
  pdfUrl: string;
  /** Optional class name for the container */
  className?: string;
  /** Height of the viewer (default: 80vh) */
  height?: string;
  /** Title shown above the viewer */
  title?: string;
  /**
   * Sync key — when this changes the iframe is force-reloaded.
   * Pass the current topic id so the PDF viewer resets scroll/zoom
   * whenever the user selects a different topic (topics in the same
   * chapter share one PDF, so the src URL alone does not change).
   */
  syncKey?: string | number;
  /** Callback when user asks AI — receives the question text, opens chat panel */
  onAskAI?: (question?: string) => void;
}

/**
 * Embedded PDF viewer using the browser's built-in PDF rendering.
 * Shows the original PDF with full fidelity — all figures, tables, and formatting preserved.
 * Text is selectable and searchable via the browser's built-in PDF.js viewer.
 */
export function PdfViewer({ pdfUrl, className, height = "75vh", title, syncKey, onAskAI }: PdfViewerProps) {
  const [fullscreen, setFullscreen] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [askText, setAskText] = useState("");
  const [popupOpen, setPopupOpen] = useState(false);
  const askInputRef = useRef<HTMLInputElement>(null);

  // When the topic/syncKey or PDF URL changes, clear any stale error state
  // so the iframe reloads cleanly for the new selection.
  useEffect(() => {
    setLoadError(false);
  }, [pdfUrl, syncKey]);

  // Append a hash that changes with syncKey so the browser reloads the
  // iframe (and scrolls to top) whenever the user selects a new topic,
  // even if the chapter-level PDF URL is unchanged.
  const iframeSrc = syncKey !== undefined
    ? `${pdfUrl}#t=${encodeURIComponent(String(syncKey))}`
    : pdfUrl;

  if (loadError) {
    return (
      <div className={cn("rounded-lg border border-dashed p-8 text-center", className)}>
        <p className="text-sm text-muted-foreground mb-3">
          PDF viewer could not load. You can download the file instead:
        </p>
        <a
          href={pdfUrl}
          download
          className="inline-flex items-center gap-1.5 text-sm text-violet-600 hover:text-violet-800 underline"
        >
          <Download className="h-4 w-4" />
          Download PDF
        </a>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-lg border overflow-hidden bg-muted/20",
        fullscreen && "fixed inset-0 z-50 rounded-none border-none",
        className
      )}
    >
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-muted/50 border-b gap-2">
        {!askOpen && (
          <span className="text-xs text-muted-foreground truncate">
            {title ?? "Original textbook page"}
          </span>
        )}

        {/* Expandable Ask AI input */}
        {onAskAI && askOpen && (
          <form
            className="flex items-center gap-1.5 flex-1 min-w-0"
            onSubmit={(e) => {
              e.preventDefault();
              const q = askText.trim();
              onAskAI(q || undefined);
              setAskText("");
              setAskOpen(false);
            }}
          >
            <Sparkles className="h-3.5 w-3.5 text-violet-500 shrink-0" />
            <input
              ref={askInputRef}
              type="text"
              value={askText}
              onChange={(e) => setAskText(e.target.value)}
              placeholder="Copy text from PDF, then paste here — or type a question..."
              className="flex-1 min-w-0 bg-transparent text-xs outline-none placeholder:text-muted-foreground/60"
              autoFocus
              onFocus={async () => {
                // Auto-fill from clipboard if user copied text from the PDF
                if (askText) return;
                try {
                  const clip = await navigator.clipboard.readText();
                  if (clip && clip.trim().length > 2 && clip.trim().length < 1000) {
                    setAskText(`Explain this: "${clip.trim().slice(0, 300)}"`);
                  }
                } catch {
                  // Clipboard access denied — user can type or use paste button
                }
              }}
            />
            <button
              type="button"
              onClick={async () => {
                try {
                  const clip = await navigator.clipboard.readText();
                  if (clip && clip.trim().length > 0) {
                    setAskText(`Explain this: "${clip.trim().slice(0, 300)}"`);
                  }
                } catch {
                  // Clipboard API not available — on some mobile browsers this triggers the paste UI
                  askInputRef.current?.focus();
                }
              }}
              className="p-1 rounded hover:bg-violet-100 dark:hover:bg-violet-900/30 transition-colors"
              title="Paste copied text"
            >
              <ClipboardPaste className="h-3.5 w-3.5 text-violet-500" />
            </button>
            <button
              type="submit"
              className="p-1 rounded hover:bg-violet-100 dark:hover:bg-violet-900/30 transition-colors"
              title="Send question"
            >
              <Send className="h-3.5 w-3.5 text-violet-600" />
            </button>
            <button
              type="button"
              onClick={() => { setAskOpen(false); setAskText(""); }}
              className="p-1 rounded hover:bg-muted transition-colors"
            >
              <X className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          </form>
        )}

        <div className="flex items-center gap-1.5 shrink-0">
          {onAskAI && !askOpen && (
            <button
              onClick={async () => {
                // Try to pre-fill from clipboard (user may have copied text from PDF)
                try {
                  const clip = await navigator.clipboard.readText();
                  if (clip && clip.trim().length > 2 && clip.trim().length < 1000) {
                    setAskText(`Explain this: "${clip.trim().slice(0, 300)}"`);
                  }
                } catch { /* clipboard not available */ }
                setAskOpen(true);
                setTimeout(() => askInputRef.current?.focus(), 100);
              }}
              className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-violet-600 text-white text-[11px] font-medium hover:bg-violet-700 transition-colors"
              title="Ask AI about this content"
            >
              <Sparkles className="h-3 w-3" />
              Ask AI
            </button>
          )}
          <button
            onClick={() => setPopupOpen(true)}
            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium text-violet-700 hover:bg-violet-100 dark:text-violet-300 dark:hover:bg-violet-900/30 transition-colors"
            title="View source PDF in popup"
          >
            <BookOpen className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Source PDF</span>
          </button>
          <a
            href={pdfUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1 rounded hover:bg-muted transition-colors"
            title="Open in new tab"
          >
            <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
          </a>
          <a
            href={pdfUrl}
            download
            className="p-1 rounded hover:bg-muted transition-colors"
            title="Download PDF"
          >
            <Download className="h-3.5 w-3.5 text-muted-foreground" />
          </a>
          <button
            onClick={() => setFullscreen(!fullscreen)}
            className="p-1 rounded hover:bg-muted transition-colors"
            title={fullscreen ? "Exit fullscreen" : "Fullscreen"}
          >
            {fullscreen ? (
              <Minimize2 className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <Maximize2 className="h-3.5 w-3.5 text-muted-foreground" />
            )}
          </button>
        </div>
      </div>

      {/* PDF iframe — keyed on syncKey+pdfUrl so it remounts on topic change */}
      <iframe
        key={`${pdfUrl}|${syncKey ?? ""}`}
        src={iframeSrc}
        className="w-full border-0"
        style={{ height: fullscreen ? "calc(100vh - 36px)" : height }}
        title={title ?? "PDF Viewer"}
        onError={() => setLoadError(true)}
      />

      {/* Source PDF popup — full-size modal */}
      <Dialog open={popupOpen} onOpenChange={setPopupOpen}>
        <DialogContent className="max-w-6xl w-[95vw] h-[90vh] p-0 gap-0 overflow-hidden flex flex-col">
          <DialogTitle className="px-4 py-2 text-sm font-semibold border-b flex items-center gap-2 shrink-0">
            <BookOpen className="h-4 w-4 text-violet-600" />
            <span className="truncate">{title ?? "Source PDF"}</span>
            <a
              href={pdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto mr-8 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
              title="Open in new tab"
            >
              <ExternalLink className="h-3.5 w-3.5" /> New tab
            </a>
          </DialogTitle>
          <iframe
            key={`popup|${pdfUrl}|${syncKey ?? ""}`}
            src={iframeSrc}
            className="flex-1 w-full border-0"
            title={title ?? "Source PDF"}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
