"use client";

import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import { cn } from "@/lib/utils";

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

/**
 * Professional study content renderer with:
 * - LaTeX math (KaTeX)
 * - Styled definition boxes, formula boxes, key points, examples
 * - Syntax highlighting for code
 * - Tables, images, GFM extensions
 * - Custom detection of content patterns → styled boxes
 */
export function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  // Pre-process content to wrap special sections in styled containers
  const processed = preprocessContent(content);

  return (
    <div className={cn("padvik-content", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex, rehypeHighlight]}
        components={{
          // Custom heading styles
          h1: ({ children, ...props }) => (
            <h1 className="text-2xl font-bold text-foreground mt-8 mb-4 pb-2 border-b border-violet-200 dark:border-violet-800" {...props}>{children}</h1>
          ),
          h2: ({ children, ...props }) => (
            <h2 className="text-xl font-bold text-foreground mt-6 mb-3 flex items-center gap-2" {...props}>
              <span className="inline-block w-1 h-6 bg-violet-600 rounded-full" />
              {children}
            </h2>
          ),
          h3: ({ children, ...props }) => (
            <h3 className="text-lg font-semibold text-foreground mt-5 mb-2" {...props}>{children}</h3>
          ),
          h4: ({ children, ...props }) => (
            <h4 className="text-base font-semibold text-foreground mt-4 mb-2" {...props}>{children}</h4>
          ),

          // Paragraphs
          p: ({ children, ...props }) => {
            const text = extractText(children);

            // Detect definition patterns
            if (text.match(/^(Definition|definition)[:\s]/i)) {
              return <div className="my-3 rounded-lg border-l-4 border-blue-500 bg-blue-50 dark:bg-blue-950/30 p-4"><p className="text-sm leading-relaxed" {...props}>{children}</p></div>;
            }

            // Detect theorem/formula patterns
            if (text.match(/^(Theorem|Formula|theorem|formula)[:\s]/i)) {
              return <div className="my-3 rounded-lg border-l-4 border-violet-500 bg-violet-50 dark:bg-violet-950/30 p-4"><p className="text-sm leading-relaxed" {...props}>{children}</p></div>;
            }

            // Detect example patterns
            if (text.match(/^(Example|Solved Example|example|EXAMPLE)[:\s\d]/i)) {
              return <div className="my-3 rounded-lg border-l-4 border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30 p-4"><p className="text-sm leading-relaxed" {...props}>{children}</p></div>;
            }

            // Detect note/important patterns
            if (text.match(/^(Note|Important|Remember|Caution|Warning|Tip)[:\s]/i)) {
              return <div className="my-3 rounded-lg border-l-4 border-amber-500 bg-amber-50 dark:bg-amber-950/30 p-4"><p className="text-sm leading-relaxed" {...props}>{children}</p></div>;
            }

            // Detect [Figure: ...] patterns
            if (text.match(/^\[Figure[:\s]/i) || text.match(/^\[Diagram[:\s]/i)) {
              return <div className="my-3 rounded-lg border border-dashed border-muted-foreground/30 bg-muted/30 p-4 text-center"><p className="text-xs text-muted-foreground italic" {...props}>{children}</p></div>;
            }

            return <p className="text-sm leading-relaxed my-2" {...props}>{children}</p>;
          },

          // Bold text — key terms
          strong: ({ children, ...props }) => (
            <strong className="font-semibold text-violet-700 dark:text-violet-400" {...props}>{children}</strong>
          ),

          // Lists
          ul: ({ children, ...props }) => (
            <ul className="my-2 ml-4 space-y-1 list-none" {...props}>
              {React.Children.map(children, (child) => {
                if (React.isValidElement(child) && child.type === 'li') {
                  return child;
                }
                return child;
              })}
            </ul>
          ),
          li: ({ children, ...props }) => (
            <li className="text-sm leading-relaxed flex items-start gap-2" {...props}>
              <span className="mt-2 h-1.5 w-1.5 rounded-full bg-violet-500 shrink-0" />
              <span>{children}</span>
            </li>
          ),
          ol: ({ children, ...props }) => (
            <ol className="my-2 ml-4 space-y-1 list-decimal list-inside" {...props}>{children}</ol>
          ),

          // Tables
          table: ({ children, ...props }) => (
            <div className="my-4 overflow-x-auto rounded-lg border">
              <table className="w-full text-sm" {...props}>{children}</table>
            </div>
          ),
          thead: ({ children, ...props }) => (
            <thead className="bg-violet-50 dark:bg-violet-950/30" {...props}>{children}</thead>
          ),
          th: ({ children, ...props }) => (
            <th className="px-3 py-2 text-left text-xs font-semibold text-violet-700 dark:text-violet-300 border-b" {...props}>{children}</th>
          ),
          td: ({ children, ...props }) => (
            <td className="px-3 py-2 text-sm border-b" {...props}>{children}</td>
          ),

          // Code blocks
          pre: ({ children, ...props }) => (
            <pre className="my-3 rounded-lg bg-gray-900 p-4 overflow-x-auto text-sm" {...props}>{children}</pre>
          ),
          code: ({ children, className: codeClassName, ...props }) => {
            const isBlock = codeClassName?.includes("language-");
            if (isBlock) {
              return <code className={codeClassName} {...props}>{children}</code>;
            }
            return <code className="rounded bg-violet-100 dark:bg-violet-900/50 px-1.5 py-0.5 text-xs font-mono text-violet-700 dark:text-violet-300" {...props}>{children}</code>;
          },

          // Blockquotes — styled as key points
          blockquote: ({ children, ...props }) => (
            <blockquote className="my-3 rounded-lg border-l-4 border-violet-500 bg-violet-50/50 dark:bg-violet-950/20 py-3 px-4 italic" {...props}>{children}</blockquote>
          ),

          // Horizontal rules — section separators
          hr: () => (
            <div className="my-6 flex items-center gap-3">
              <div className="h-px flex-1 bg-gradient-to-r from-transparent via-violet-300 to-transparent dark:via-violet-700" />
            </div>
          ),

          // Images
          img: ({ src, alt, ...props }) => (
            <figure className="my-4">
              <img src={src} alt={alt} className="rounded-lg border max-w-full mx-auto" {...props} />
              {alt && <figcaption className="mt-1 text-center text-xs text-muted-foreground italic">{alt}</figcaption>}
            </figure>
          ),

          // Links
          a: ({ children, href, ...props }) => (
            <a href={href} className="text-violet-600 dark:text-violet-400 underline underline-offset-2 hover:text-violet-800 dark:hover:text-violet-300" target="_blank" rel="noopener noreferrer" {...props}>{children}</a>
          ),
        }}
      >
        {processed}
      </ReactMarkdown>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pre-processing: detect special sections and wrap them
// ---------------------------------------------------------------------------

function preprocessContent(content: string): string {
  let result = content;

  // Wrap "Key Points" / "Summary" / "Quick Revision" sections in a box
  result = result.replace(
    /^(#{2,3})\s*(Key Points|Summary|Quick Revision|Important Points|Remember|Takeaway|Recap)(.*)$/gim,
    '$1 $2$3'
  );

  return result;
}

function extractText(children: React.ReactNode): string {
  if (typeof children === "string") return children;
  if (typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(extractText).join("");
  if (React.isValidElement(children)) {
    const props = children.props as Record<string, unknown>;
    if (props.children) return extractText(props.children as React.ReactNode);
  }
  return "";
}
