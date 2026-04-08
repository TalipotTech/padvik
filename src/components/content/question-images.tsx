"use client";

import { useState } from "react";
import { Image as ImageIcon, ZoomIn, X } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface QuestionImage {
  url: string;
  caption?: string;
  alt?: string;
  pageNumber?: number;
}

interface QuestionImagesProps {
  images: QuestionImage[];
  className?: string;
  /** Compact mode for inline display within question text */
  compact?: boolean;
}

// ---------------------------------------------------------------------------
// Question Images Component
// ---------------------------------------------------------------------------
// Renders question images (figures, diagrams) inline.
// Used in question-viewer and question-card when questionImages is non-empty.

export function QuestionImages({ images, className, compact = false }: QuestionImagesProps) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  if (!images || images.length === 0) return null;

  return (
    <div className={cn("space-y-2", className)}>
      {!compact && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <ImageIcon className="h-3 w-3" />
          <span>{images.length} figure{images.length > 1 ? "s" : ""}</span>
        </div>
      )}

      <div className={cn(
        "grid gap-2",
        images.length === 1 ? "grid-cols-1" : "grid-cols-2"
      )}>
        {images.map((img, idx) => (
          <figure
            key={idx}
            className="relative rounded-lg border overflow-hidden bg-muted/20 group cursor-pointer"
            onClick={() => setExpandedIdx(expandedIdx === idx ? null : idx)}
          >
            <img
              src={img.url}
              alt={img.alt ?? img.caption ?? `Figure ${idx + 1}`}
              className={cn(
                "w-full object-contain",
                compact ? "max-h-48" : "max-h-64",
                expandedIdx === idx && "max-h-none"
              )}
              loading="lazy"
            />
            {img.caption && (
              <figcaption className="px-2 py-1 text-[10px] text-muted-foreground text-center bg-muted/30">
                {img.caption}
              </figcaption>
            )}
            <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity">
              {expandedIdx === idx ? (
                <X className="h-4 w-4 text-white bg-black/50 rounded p-0.5" />
              ) : (
                <ZoomIn className="h-4 w-4 text-white bg-black/50 rounded p-0.5" />
              )}
            </div>
          </figure>
        ))}
      </div>
    </div>
  );
}

/**
 * Parse questionImages from a JSONB field (could be various shapes).
 * Returns a normalized array of QuestionImage objects.
 */
export function parseQuestionImages(raw: unknown): QuestionImage[] {
  if (!raw) return [];
  if (!Array.isArray(raw)) return [];

  return raw
    .filter((item): item is Record<string, unknown> => item !== null && typeof item === "object")
    .map((item) => ({
      url: String(item.url ?? item.src ?? item.path ?? ""),
      caption: item.caption ? String(item.caption) : undefined,
      alt: item.alt ? String(item.alt) : undefined,
      pageNumber: item.pageNumber ? Number(item.pageNumber) : undefined,
    }))
    .filter((img) => img.url.length > 0);
}
