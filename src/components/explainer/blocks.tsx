"use client";

/**
 * Individual block renderers for an ExplainerCard.
 * Every block type from types.ts has a renderer here. Unknown types render
 * nothing so an AI that invents a new shape fails gracefully.
 */
import { useMemo, useState } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { CheckCircle2, XCircle, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ContentBlock } from "@/lib/explainer/types";

function sanitizeSvg(svg: string): string {
  // Strip <script> tags and on* handlers — cards are AI-generated and must
  // never inject executable content.
  return svg
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\son\w+="[^"]*"/gi, "")
    .replace(/\son\w+='[^']*'/gi, "");
}

function TextBlockView({ content }: { content: string }) {
  return (
    <div className="prose prose-sm max-w-none text-foreground prose-p:my-2 prose-headings:text-foreground dark:prose-invert">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
        {content}
      </ReactMarkdown>
    </div>
  );
}

function HeadingBlockView({ content }: { content: string }) {
  return <h3 className="text-lg font-semibold text-foreground">{content}</h3>;
}

function FormulaBlockView({ latex }: { latex: string }) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(latex, {
        displayMode: true,
        throwOnError: false,
        strict: "ignore",
      });
    } catch {
      return latex;
    }
  }, [latex]);
  return (
    <div
      className="my-2 flex items-center justify-center overflow-x-auto rounded-md bg-purple-50 px-4 py-3 dark:bg-purple-950/40"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function DiagramBlockView({ svg }: { svg: string }) {
  const safe = useMemo(() => sanitizeSvg(svg), [svg]);
  return (
    <div
      className="flex items-center justify-center overflow-hidden rounded-lg border border-purple-200 bg-white p-2 dark:border-purple-900 dark:bg-slate-900"
      dangerouslySetInnerHTML={{ __html: safe }}
    />
  );
}

function CalloutBlockView({
  variant,
  content,
}: {
  variant: "tip" | "warning" | "remember" | "example";
  content: string;
}) {
  const classes = {
    tip: "border-purple-300 bg-purple-50 text-purple-900 dark:border-purple-800 dark:bg-purple-950/50 dark:text-purple-200",
    warning: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-100",
    remember: "border-blue-300 bg-blue-50 text-blue-900 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-100",
    example: "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-100",
  }[variant];

  const labels = {
    tip: "Tip",
    warning: "Be careful",
    remember: "Remember",
    example: "Example",
  };

  return (
    <div className={cn("rounded-lg border-l-4 p-3", classes)}>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide">
        {labels[variant]}
      </p>
      <div className="text-sm">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </div>
    </div>
  );
}

function ComparisonBlockView({
  leftLabel,
  rightLabel,
  left,
  right,
}: {
  leftLabel: string;
  rightLabel: string;
  left: string;
  right: string;
}) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {[
        { label: leftLabel, content: left, tone: "bg-rose-50 border-rose-200 dark:bg-rose-950/40 dark:border-rose-900" },
        { label: rightLabel, content: right, tone: "bg-emerald-50 border-emerald-200 dark:bg-emerald-950/40 dark:border-emerald-900" },
      ].map((col) => (
        <div key={col.label} className={cn("rounded-lg border p-3", col.tone)}>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide">
            {col.label}
          </p>
          <div className="text-sm">
            <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
              {col.content}
            </ReactMarkdown>
          </div>
        </div>
      ))}
    </div>
  );
}

function StepsBlockView({ items }: { items: string[] }) {
  return (
    <ol className="space-y-2">
      {items.map((step, i) => (
        <li
          key={i}
          className="flex items-start gap-2 rounded-md border border-purple-200 bg-purple-50/40 p-2 text-sm dark:border-purple-900 dark:bg-purple-950/20"
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-purple-600 text-xs font-bold text-white">
            {i + 1}
          </span>
          <div className="flex-1 pt-0.5">
            <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
              {step}
            </ReactMarkdown>
          </div>
        </li>
      ))}
    </ol>
  );
}

function AnalogyBlockView({
  source,
  target,
  mapping,
}: {
  source: string;
  target: string;
  mapping: Array<{ from: string; to: string }>;
}) {
  return (
    <div className="rounded-lg border border-purple-200 bg-gradient-to-br from-purple-50 to-violet-50 p-3 dark:border-purple-900 dark:from-purple-950/40 dark:to-violet-950/40">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium text-purple-900 dark:text-purple-200">
        <span className="rounded-md bg-white px-2 py-0.5 text-xs dark:bg-slate-900">
          {source}
        </span>
        <span className="text-purple-500">≈</span>
        <span className="rounded-md bg-white px-2 py-0.5 text-xs dark:bg-slate-900">
          {target}
        </span>
      </div>
      <div className="space-y-1 text-sm">
        {mapping.map((m, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="flex-1 rounded bg-white/70 px-2 py-1 dark:bg-slate-900/50">
              {m.from}
            </span>
            <span className="text-purple-500">→</span>
            <span className="flex-1 rounded bg-white/70 px-2 py-1 dark:bg-slate-900/50">
              {m.to}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function QuickCheckBlockView({
  question,
  options,
  correctIndex,
  explanation,
}: {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const answered = selected !== null;

  return (
    <div className="rounded-lg border border-purple-200 bg-white p-3 dark:border-purple-900 dark:bg-slate-900">
      <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-purple-900 dark:text-purple-200">
        <Info size={14} /> Quick check
      </p>
      <div className="mb-2 text-sm">
        <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
          {question}
        </ReactMarkdown>
      </div>
      <div className="space-y-1.5">
        {options.map((opt, i) => {
          const isCorrect = i === correctIndex;
          const isSelected = selected === i;
          return (
            <button
              key={i}
              onClick={() => !answered && setSelected(i)}
              disabled={answered}
              className={cn(
                "flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors",
                !answered && "hover:border-purple-400 hover:bg-purple-50 dark:hover:bg-purple-950/40",
                answered && isCorrect && "border-emerald-400 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-950/40",
                answered && isSelected && !isCorrect && "border-rose-400 bg-rose-50 dark:border-rose-700 dark:bg-rose-950/40",
                !answered && "border-slate-200 dark:border-slate-700"
              )}
            >
              {answered && isCorrect && <CheckCircle2 size={16} className="text-emerald-600" />}
              {answered && isSelected && !isCorrect && <XCircle size={16} className="text-rose-600" />}
              <span className="flex-1">{opt}</span>
            </button>
          );
        })}
      </div>
      {answered && (
        <div className="mt-2 rounded-md bg-purple-50 p-2 text-xs text-purple-900 dark:bg-purple-950/40 dark:text-purple-200">
          <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
            {explanation}
          </ReactMarkdown>
        </div>
      )}
    </div>
  );
}

function InteractiveRevealBlockView({
  prompt,
  answer,
}: {
  prompt: string;
  answer: string;
}) {
  const [revealed, setRevealed] = useState(false);
  return (
    <div className="rounded-lg border border-dashed border-purple-300 bg-purple-50/50 p-3 dark:border-purple-800 dark:bg-purple-950/20">
      <p className="mb-2 text-sm font-medium">{prompt}</p>
      {revealed ? (
        <div className="text-sm">
          <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
            {answer}
          </ReactMarkdown>
        </div>
      ) : (
        <button
          onClick={() => setRevealed(true)}
          className="rounded-md bg-purple-600 px-3 py-1 text-xs font-medium text-white hover:bg-purple-700"
        >
          Reveal
        </button>
      )}
    </div>
  );
}

function ImageBlockView({ url, alt }: { url: string; alt: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={alt} className="mx-auto max-h-64 rounded-lg" />;
}

function AnimationBlockView({
  frames,
}: {
  frames: Array<{ svg: string; caption: string }>;
}) {
  const [frame, setFrame] = useState(0);
  const f = frames[frame];
  const safeSvg = useMemo(() => sanitizeSvg(f.svg), [f.svg]);
  return (
    <div className="rounded-lg border border-purple-200 bg-white p-2 dark:border-purple-900 dark:bg-slate-900">
      <div
        className="flex items-center justify-center"
        dangerouslySetInnerHTML={{ __html: safeSvg }}
      />
      <p className="mt-2 text-center text-xs text-muted-foreground">{f.caption}</p>
      <div className="mt-2 flex items-center justify-between gap-2">
        <button
          onClick={() => setFrame((i) => Math.max(0, i - 1))}
          disabled={frame === 0}
          className="rounded bg-slate-100 px-2 py-1 text-xs disabled:opacity-50 dark:bg-slate-800"
        >
          ← Back
        </button>
        <span className="text-xs text-muted-foreground">
          {frame + 1} / {frames.length}
        </span>
        <button
          onClick={() => setFrame((i) => Math.min(frames.length - 1, i + 1))}
          disabled={frame === frames.length - 1}
          className="rounded bg-purple-600 px-2 py-1 text-xs text-white disabled:opacity-50"
        >
          Next →
        </button>
      </div>
    </div>
  );
}

export function BlockView({ block }: { block: ContentBlock }) {
  switch (block.type) {
    case "text":
      return <TextBlockView content={block.content} />;
    case "heading":
      return <HeadingBlockView content={block.content} />;
    case "formula":
      return <FormulaBlockView latex={block.latex} />;
    case "diagram":
      return <DiagramBlockView svg={block.svg} />;
    case "image":
      return <ImageBlockView url={block.url} alt={block.alt} />;
    case "callout":
      return <CalloutBlockView variant={block.variant} content={block.content} />;
    case "comparison":
      return (
        <ComparisonBlockView
          leftLabel={block.leftLabel}
          rightLabel={block.rightLabel}
          left={block.left}
          right={block.right}
        />
      );
    case "steps":
      return <StepsBlockView items={block.items} />;
    case "analogy":
      return (
        <AnalogyBlockView
          source={block.source}
          target={block.target}
          mapping={block.mapping}
        />
      );
    case "quick_check":
      return (
        <QuickCheckBlockView
          question={block.question}
          options={block.options}
          correctIndex={block.correctIndex}
          explanation={block.explanation}
        />
      );
    case "interactive_reveal":
      return <InteractiveRevealBlockView prompt={block.prompt} answer={block.answer} />;
    case "animation":
      return <AnimationBlockView frames={block.frames} />;
    default:
      return null;
  }
}
