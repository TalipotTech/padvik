"use client";

import React, { useState } from "react";
import { MarkdownRenderer } from "@/components/content/markdown-renderer";
import { cn } from "@/lib/utils";
import {
  BookOpen, Image as ImageIcon, Table2, FlaskConical,
  Lightbulb, AlertTriangle, GraduationCap, Activity,
  ChevronDown, ChevronUp, ZoomIn,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types (mirrors src/lib/document-parser/types.ts for client use)
// ---------------------------------------------------------------------------

interface RichContentBlock {
  type: "heading" | "text" | "image" | "table" | "formula" | "callout";
  content: string;
  level?: 1 | 2 | 3 | 4;
  imagePath?: string;
  imageCaption?: string;
  calloutVariant?: "definition" | "theorem" | "example" | "note" | "important" | "activity";
  pageNumber: number;
  blockIndex: number;
}

interface PageImage {
  pageNumber: number;
  relativePath: string;
  url?: string;
  width: number;
  height: number;
}

interface RichContentViewerProps {
  blocks: RichContentBlock[];
  pageImages?: PageImage[];
  contentItemId?: number | string;
  className?: string;
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function RichContentViewer({
  blocks,
  pageImages = [],
  contentItemId,
  className,
}: RichContentViewerProps) {
  // Group blocks by page and render with optional page preview toggles
  const pages = new Map<number, RichContentBlock[]>();
  for (const block of blocks) {
    const pg = block.pageNumber;
    if (!pages.has(pg)) pages.set(pg, []);
    pages.get(pg)!.push(block);
  }

  return (
    <div className={cn("padvik-rich-content space-y-3", className)}>
      {blocks.map((block) => (
        <RichBlock
          key={block.blockIndex}
          block={block}
          pageImages={pageImages}
          contentItemId={contentItemId}
        />
      ))}
      {/* Page thumbnails strip at the bottom */}
      {pageImages.length > 0 && (
        <PageStrip pageImages={pageImages} contentItemId={contentItemId} />
      )}
    </div>
  );
}

/** Compact page thumbnail strip — lets users browse original pages */
function PageStrip({ pageImages, contentItemId }: { pageImages: PageImage[]; contentItemId?: number | string }) {
  const [expandedPage, setExpandedPage] = useState<number | null>(null);

  const getPageUrl = (pageNumber: number) => {
    if (contentItemId) {
      return `/api/rich-content/images/${contentItemId}/page-${pageNumber}.png`;
    }
    const pi = pageImages.find(p => p.pageNumber === pageNumber);
    if (pi?.url) return pi.url as string;
    if (pi?.relativePath) {
      const match = pi.relativePath.match(/rich-content\/([^/]+)\/page-(\d+)\.png/);
      if (match) return `/api/rich-content/images/${match[1]}/${match[2]}.png`;
    }
    return "";
  };

  return (
    <div className="mt-6 pt-4 border-t">
      <div className="flex items-center gap-2 mb-2 text-xs text-muted-foreground">
        <ImageIcon className="h-3.5 w-3.5" />
        <span>Original pages ({pageImages.length})</span>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-2">
        {pageImages.map((pi) => (
          <button
            key={pi.pageNumber}
            onClick={() => setExpandedPage(expandedPage === pi.pageNumber ? null : pi.pageNumber)}
            className={cn(
              "shrink-0 w-12 h-16 rounded border text-[10px] flex items-center justify-center transition-colors",
              expandedPage === pi.pageNumber
                ? "border-violet-500 bg-violet-50 dark:bg-violet-950/30 text-violet-700"
                : "border-muted hover:border-violet-300 text-muted-foreground"
            )}
          >
            p.{pi.pageNumber}
          </button>
        ))}
      </div>
      {expandedPage && (
        <div className="mt-2 rounded-lg border overflow-hidden">
          <img
            src={getPageUrl(expandedPage)}
            alt={`Page ${expandedPage}`}
            className="w-full"
            loading="lazy"
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Block Renderer
// ---------------------------------------------------------------------------

function RichBlock({
  block,
  pageImages,
  contentItemId,
}: {
  block: RichContentBlock;
  pageImages: PageImage[];
  contentItemId?: number | string;
}) {
  switch (block.type) {
    case "heading":
      return <HeadingBlock block={block} />;
    case "text":
      return <TextBlock block={block} />;
    case "image":
      return (
        <ImageBlock
          block={block}
          pageImages={pageImages}
          contentItemId={contentItemId}
        />
      );
    case "table":
      return <TableBlock block={block} />;
    case "formula":
      return <FormulaBlock block={block} />;
    case "callout":
      return <CalloutBlock block={block} />;
    default:
      return <TextBlock block={block} />;
  }
}

// ---------------------------------------------------------------------------
// Heading Block
// ---------------------------------------------------------------------------

function HeadingBlock({ block }: { block: RichContentBlock }) {
  const level = block.level ?? 2;
  const accentBar = level === 2 && (
    <span className="inline-block w-1 h-6 bg-violet-600 rounded-full" />
  );

  switch (level) {
    case 1:
      return <h1 className="text-2xl font-bold text-foreground mt-8 mb-4 pb-2 border-b border-violet-200 dark:border-violet-800">{block.content}</h1>;
    case 2:
      return <h2 className="text-xl font-bold text-foreground mt-6 mb-3 flex items-center gap-2">{accentBar}{block.content}</h2>;
    case 3:
      return <h3 className="text-lg font-semibold text-foreground mt-5 mb-2">{block.content}</h3>;
    case 4:
      return <h4 className="text-base font-semibold text-foreground mt-4 mb-2">{block.content}</h4>;
    default:
      return <h2 className="text-xl font-bold text-foreground mt-6 mb-3 flex items-center gap-2">{accentBar}{block.content}</h2>;
  }
}

// ---------------------------------------------------------------------------
// Text Block
// ---------------------------------------------------------------------------

function TextBlock({ block }: { block: RichContentBlock }) {
  return <MarkdownRenderer content={block.content} />;
}

// ---------------------------------------------------------------------------
// Image Block — shows page screenshot with the figure
// ---------------------------------------------------------------------------

function ImageBlock({
  block,
  pageImages,
  contentItemId,
}: {
  block: RichContentBlock;
  pageImages: PageImage[];
  contentItemId?: number | string;
}) {
  const [showPage, setShowPage] = useState(false);

  // Resolve image URL for the page containing this figure
  let pageUrl = "";
  if (contentItemId) {
    pageUrl = `/api/rich-content/images/${contentItemId}/page-${block.pageNumber}.png`;
  } else if (block.imagePath) {
    if (block.imagePath.startsWith("data/uploads/rich-content/")) {
      const match = block.imagePath.match(/rich-content\/([^/]+)\/page-(\d+)\.png/);
      if (match) pageUrl = `/api/rich-content/images/${match[1]}/page-${match[2]}.png`;
    } else if (block.imagePath.startsWith("/api/")) {
      pageUrl = block.imagePath;
    }
  }

  return (
    <figure className="my-4 rounded-lg border border-violet-200 dark:border-violet-800 overflow-hidden">
      {/* Figure header */}
      <div className="flex items-center justify-between px-3 py-2 bg-violet-50 dark:bg-violet-950/30">
        <div className="flex items-center gap-2 text-sm font-medium text-violet-700 dark:text-violet-300">
          <ImageIcon className="h-4 w-4" />
          {block.imageCaption ?? `Figure (Page ${block.pageNumber})`}
        </div>
        {pageUrl && (
          <button
            onClick={() => setShowPage(!showPage)}
            className="text-[11px] flex items-center gap-1 text-muted-foreground hover:text-violet-600 transition-colors"
          >
            {showPage ? <ChevronUp className="h-3 w-3" /> : <ZoomIn className="h-3 w-3" />}
            {showPage ? "Hide" : "See in page"}
          </button>
        )}
      </div>

      {/* AI description of the figure */}
      <div className="px-4 py-2.5 bg-white dark:bg-gray-950/50">
        <p className="text-sm text-muted-foreground italic leading-relaxed">
          {block.content}
        </p>
      </div>

      {/* Expandable: original page showing this figure in context */}
      {showPage && pageUrl && (
        <div className="border-t p-2">
          <img
            src={pageUrl}
            alt={block.imageCaption ?? `Page ${block.pageNumber}`}
            className="w-full rounded"
            loading="lazy"
          />
        </div>
      )}
    </figure>
  );
}

// ---------------------------------------------------------------------------
// Table Block
// ---------------------------------------------------------------------------

function TableBlock({ block }: { block: RichContentBlock }) {
  return (
    <div className="my-4">
      <div className="flex items-center gap-2 mb-2 text-sm text-muted-foreground">
        <Table2 className="h-4 w-4" />
        <span>Table</span>
      </div>
      <MarkdownRenderer content={block.content} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Formula Block
// ---------------------------------------------------------------------------

function FormulaBlock({ block }: { block: RichContentBlock }) {
  // Wrap in $$ for KaTeX rendering via MarkdownRenderer
  const formula = block.content.startsWith("$$")
    ? block.content
    : `$$\n${block.content}\n$$`;

  return (
    <div className="my-4 rounded-lg border-l-4 border-violet-500 bg-violet-50 dark:bg-violet-950/30 p-4">
      <div className="flex items-center gap-2 mb-2 text-xs font-semibold text-violet-600 dark:text-violet-400">
        <FlaskConical className="h-3.5 w-3.5" />
        Formula
      </div>
      <MarkdownRenderer content={formula} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Callout Block
// ---------------------------------------------------------------------------

const CALLOUT_STYLES: Record<string, {
  border: string;
  bg: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}> = {
  definition: {
    border: "border-blue-500",
    bg: "bg-blue-50 dark:bg-blue-950/30",
    icon: BookOpen,
    label: "Definition",
  },
  theorem: {
    border: "border-violet-500",
    bg: "bg-violet-50 dark:bg-violet-950/30",
    icon: FlaskConical,
    label: "Theorem / Formula",
  },
  example: {
    border: "border-emerald-500",
    bg: "bg-emerald-50 dark:bg-emerald-950/30",
    icon: GraduationCap,
    label: "Example",
  },
  note: {
    border: "border-amber-500",
    bg: "bg-amber-50 dark:bg-amber-950/30",
    icon: Lightbulb,
    label: "Note",
  },
  important: {
    border: "border-red-500",
    bg: "bg-red-50 dark:bg-red-950/30",
    icon: AlertTriangle,
    label: "Important",
  },
  activity: {
    border: "border-teal-500",
    bg: "bg-teal-50 dark:bg-teal-950/30",
    icon: Activity,
    label: "Activity",
  },
};

function CalloutBlock({ block }: { block: RichContentBlock }) {
  const variant = block.calloutVariant ?? "note";
  const style = CALLOUT_STYLES[variant] ?? CALLOUT_STYLES.note;
  const Icon = style.icon;

  return (
    <div className={cn("my-3 rounded-lg border-l-4 p-4", style.border, style.bg)}>
      <div className="flex items-center gap-2 mb-2 text-xs font-semibold text-foreground/70">
        <Icon className="h-3.5 w-3.5" />
        {style.label}
      </div>
      <div className="text-sm leading-relaxed">
        <MarkdownRenderer content={block.content} />
      </div>
    </div>
  );
}
