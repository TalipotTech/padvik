"use client";

/**
 * Dedicated renderer for OCR structured blocks.
 * Renders each OcrBlock type with a purpose-built React component —
 * no markdown intermediate conversion.
 *
 * Used for handwritten note extraction (tables, formulas, division ladders, diagrams).
 */

import React from "react";
import { MarkdownRenderer } from "@/components/content/markdown-renderer";
import type {
  OcrBlock,
  OcrTextBlock as OcrTextBlockType,
  OcrHeadingBlock as OcrHeadingBlockType,
  OcrTableBlock as OcrTableBlockType,
  OcrFormulaBlock as OcrFormulaBlockType,
  OcrDiagramBlock as OcrDiagramBlockType,
  OcrDivisionLadderBlock as OcrDivisionLadderBlockType,
  OcrProblemBlock as OcrProblemBlockType,
  OcrVerificationBlock as OcrVerificationBlockType,
} from "@/lib/content-pipeline/ocr-blocks";
import {
  FlaskConical,
  Lightbulb,
  CheckCircle2,
  BookOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

interface OcrBlockRendererProps {
  blocks: OcrBlock[];
  className?: string;
}

export function OcrBlockRenderer({ blocks, className }: OcrBlockRendererProps) {
  return (
    <div className={cn("space-y-4", className)}>
      {blocks.map((block, index) => (
        <OcrBlockSwitch key={index} block={block} />
      ))}
    </div>
  );
}

function OcrBlockSwitch({ block }: { block: OcrBlock }) {
  switch (block.type) {
    case "heading":
      return <HeadingBlock block={block} />;
    case "text":
      return <TextBlock block={block} />;
    case "table":
      return <TableBlock block={block} />;
    case "formula":
      return <FormulaBlock block={block} />;
    case "division_ladder":
      return <DivisionLadderBlock block={block} />;
    case "diagram":
      return <DiagramBlock block={block} />;
    case "problem":
      return <ProblemBlock block={block} />;
    case "verification":
      return <VerificationBlock block={block} />;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Heading Block
// ---------------------------------------------------------------------------

function HeadingBlock({ block }: { block: OcrHeadingBlockType }) {
  const level = block.level ?? 2;
  const base = "font-bold text-foreground";

  switch (level) {
    case 1:
      return (
        <h1 className={`text-xl ${base} mt-6 mb-3 pb-2 border-b border-violet-200 dark:border-violet-800`}>
          {block.content}
        </h1>
      );
    case 2:
      return (
        <h2 className={`text-lg ${base} mt-5 mb-2 flex items-center gap-2`}>
          <span className="inline-block w-1 h-5 bg-violet-600 rounded-full" />
          {block.content}
        </h2>
      );
    case 3:
      return <h3 className={`text-base font-semibold text-foreground mt-4 mb-1.5`}>{block.content}</h3>;
    case 4:
      return <h4 className={`text-sm font-semibold text-foreground mt-3 mb-1`}>{block.content}</h4>;
    default:
      return <h2 className={`text-lg ${base} mt-5 mb-2`}>{block.content}</h2>;
  }
}

// ---------------------------------------------------------------------------
// Text Block — uses MarkdownRenderer for inline $...$ LaTeX
// ---------------------------------------------------------------------------

function TextBlock({ block }: { block: OcrTextBlockType }) {
  return <MarkdownRenderer content={block.content} />;
}

// ---------------------------------------------------------------------------
// Table Block — proper HTML table, no markdown conversion
// ---------------------------------------------------------------------------

function TableBlock({ block }: { block: OcrTableBlockType }) {
  const hasHeaders = block.headers.length > 0;
  const columnCount = hasHeaders ? block.headers.length : block.rows[0]?.length ?? 0;

  return (
    <div className="space-y-1.5">
      {block.caption && (
        <p className="text-sm font-semibold text-violet-700 dark:text-violet-400">{block.caption}</p>
      )}
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          {hasHeaders && (
            <thead>
              <tr className="bg-violet-50 dark:bg-violet-950/30 border-b">
                {block.headers.map((header, i) => (
                  <th
                    key={i}
                    className="px-4 py-2 text-left font-semibold text-violet-800 dark:text-violet-300"
                  >
                    <MarkdownRenderer content={header} className="inline" />
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {block.rows.map((row, ri) => (
              <tr
                key={ri}
                className={cn(
                  "border-b last:border-b-0",
                  ri % 2 === 1 && "bg-muted/30"
                )}
              >
                {row.map((cell, ci) => (
                  <td key={ci} className="px-4 py-2 text-foreground">
                    {cell === "—" ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <MarkdownRenderer content={cell} className="inline" />
                    )}
                  </td>
                ))}
                {/* Pad if row is shorter than headers */}
                {Array.from({ length: Math.max(0, columnCount - row.length) }).map((_, i) => (
                  <td key={`pad-${i}`} className="px-4 py-2" />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {block.pattern && (
        <p className="text-xs text-muted-foreground italic">Pattern: {block.pattern}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Formula Block — direct KaTeX rendering
// ---------------------------------------------------------------------------

function FormulaBlock({ block }: { block: OcrFormulaBlockType }) {
  return (
    <div className="rounded-lg border border-amber-200 dark:border-amber-800/50 bg-amber-50/50 dark:bg-amber-950/20 px-4 py-3 space-y-1">
      <div className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400 font-medium">
        <FlaskConical className="h-3.5 w-3.5" />
        {block.label || "Formula"}
      </div>
      <div className="text-center py-1">
        <MarkdownRenderer content={`$$${block.latex}$$`} />
      </div>
      {block.description && (
        <p className="text-xs text-muted-foreground text-center italic">{block.description}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Division Ladder Block — custom layout for prime factorisation
// ---------------------------------------------------------------------------

function DivisionLadderBlock({ block }: { block: OcrDivisionLadderBlockType }) {
  const caption = block.caption || `Prime factorisation of ${block.number}`;

  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold text-violet-700 dark:text-violet-400">{caption}</p>
      <div className="overflow-x-auto rounded-lg border inline-block">
        <table className="text-sm">
          <thead>
            <tr className="bg-violet-50 dark:bg-violet-950/30 border-b">
              <th className="px-4 py-1.5 text-left font-semibold text-violet-800 dark:text-violet-300 w-20">
                Divisor
              </th>
              <th className="px-4 py-1.5 text-right font-semibold text-violet-800 dark:text-violet-300 w-24">
                Number
              </th>
            </tr>
          </thead>
          <tbody>
            {/* First row: first divisor | original number */}
            {block.steps.length > 0 && (
              <tr className="border-b">
                <td className="px-4 py-1.5 font-mono text-sm border-r">{block.steps[0].divisor}</td>
                <td className="px-4 py-1.5 font-mono text-sm text-right font-semibold">{block.number}</td>
              </tr>
            )}
            {/* Subsequent rows: next divisor | current quotient */}
            {block.steps.map((step, i) => {
              const nextDivisor = block.steps[i + 1]?.divisor;
              return (
                <tr key={i} className={cn("border-b last:border-b-0", i % 2 === 0 && "bg-muted/20")}>
                  <td className="px-4 py-1.5 font-mono text-sm border-r text-muted-foreground">
                    {nextDivisor ?? ""}
                  </td>
                  <td className="px-4 py-1.5 font-mono text-sm text-right">{step.quotient}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {/* Factorisation result */}
      {block.result && (
        <div className="text-sm">
          <MarkdownRenderer content={`$${block.number} = ${block.result}$`} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Diagram Block — description card with optional SVG
// ---------------------------------------------------------------------------

function DiagramBlock({ block }: { block: OcrDiagramBlockType }) {
  return (
    <div className="rounded-lg border border-blue-200 dark:border-blue-800/50 bg-blue-50/50 dark:bg-blue-950/20 px-4 py-3 space-y-2">
      <div className="flex items-center gap-1.5 text-xs text-blue-700 dark:text-blue-400 font-medium">
        <Lightbulb className="h-3.5 w-3.5" />
        Diagram{block.diagramType ? ` (${block.diagramType})` : ""}
      </div>
      {block.svg ? (
        <div
          className="flex justify-center"
          dangerouslySetInnerHTML={{ __html: block.svg }}
        />
      ) : (
        <p className="text-sm text-foreground">{block.description}</p>
      )}
      {block.elements && block.elements.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Elements: {block.elements.join(", ")}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Problem Block — highlighted problem statement
// ---------------------------------------------------------------------------

function ProblemBlock({ block }: { block: OcrProblemBlockType }) {
  return (
    <div className="rounded-lg border-l-4 border-violet-500 bg-violet-50/50 dark:bg-violet-950/20 px-4 py-3 space-y-1">
      <div className="flex items-center gap-1.5 text-xs text-violet-700 dark:text-violet-400 font-semibold uppercase tracking-wide">
        <BookOpen className="h-3.5 w-3.5" />
        Problem
      </div>
      <div className="text-sm text-foreground">
        <MarkdownRenderer content={block.statement} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Verification Block — verification step with check mark
// ---------------------------------------------------------------------------

function VerificationBlock({ block }: { block: OcrVerificationBlockType }) {
  return (
    <div className="rounded-lg border border-green-200 dark:border-green-800/50 bg-green-50/50 dark:bg-green-950/20 px-4 py-3 space-y-1">
      <div className="flex items-center gap-1.5 text-xs text-green-700 dark:text-green-400 font-medium">
        <CheckCircle2 className="h-3.5 w-3.5" />
        {block.label || "Verification"}
      </div>
      <div className="text-center py-1">
        <MarkdownRenderer content={`$$${block.latex}$$`} />
      </div>
      {block.check && (
        <div className="text-center text-xs text-green-700 dark:text-green-400">
          <MarkdownRenderer content={`$${block.check}$`} className="inline" />
        </div>
      )}
    </div>
  );
}
