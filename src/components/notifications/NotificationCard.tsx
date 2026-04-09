import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { FileDown, ExternalLink } from "lucide-react";

const CATEGORY_COLORS: Record<string, string> = {
  exam_date: "border-l-violet-500",
  result: "border-l-green-500",
  admit_card: "border-l-amber-500",
  circular: "border-l-blue-500",
  syllabus: "border-l-red-500",
  policy: "border-l-orange-500",
  general: "border-l-gray-400",
};

const CATEGORY_LABELS: Record<string, string> = {
  exam_date: "Exam Date",
  result: "Result",
  admit_card: "Admit Card",
  circular: "Circular",
  syllabus: "Syllabus",
  policy: "Policy",
  general: "General",
};

const CATEGORY_BADGE_VARIANTS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  exam_date: "default",
  result: "secondary",
  admit_card: "outline",
  circular: "secondary",
  syllabus: "destructive",
  policy: "outline",
  general: "outline",
};

const BOARD_STYLES: Record<string, { bg: string; text: string; initials: string }> = {
  CBSE: { bg: "bg-blue-600", text: "text-white", initials: "CB" },
  ICSE: { bg: "bg-emerald-600", text: "text-white", initials: "IC" },
  KL_SCERT: { bg: "bg-amber-600", text: "text-white", initials: "KL" },
  KA_KSEAB: { bg: "bg-red-600", text: "text-white", initials: "KA" },
  TN_DGE: { bg: "bg-indigo-600", text: "text-white", initials: "TN" },
  MH_MSBSHSE: { bg: "bg-orange-600", text: "text-white", initials: "MH" },
  AP_BSEAP: { bg: "bg-teal-600", text: "text-white", initials: "AP" },
  TS_BSETS: { bg: "bg-pink-600", text: "text-white", initials: "TS" },
};

function getBoardStyle(code?: string) {
  if (!code) return { bg: "bg-violet-600", text: "text-white", initials: "?" };
  return BOARD_STYLES[code] ?? { bg: "bg-violet-600", text: "text-white", initials: code.slice(0, 2) };
}

interface NotificationCardProps {
  id: number;
  title: string;
  slug: string | null;
  category: string;
  summary: string | null;
  sourceUrl: string;
  pdfUrl: string | null;
  priority: string;
  isBreaking: boolean;
  publishedAt: string;
  boardCode?: string;
  boardName?: string;
  showBoard?: boolean;
}

function relativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return `${Math.floor(diffDays / 365)} years ago`;
}

export function NotificationCard({
  title,
  slug,
  category,
  summary,
  pdfUrl,
  priority,
  isBreaking,
  publishedAt,
  boardCode,
  boardName,
  showBoard = false,
}: NotificationCardProps) {
  const borderColor = CATEGORY_COLORS[category] ?? CATEGORY_COLORS.general;
  const label = CATEGORY_LABELS[category] ?? "General";
  const badgeVariant = CATEGORY_BADGE_VARIANTS[category] ?? "outline";
  const board = getBoardStyle(boardCode);

  return (
    <div
      className={`rounded-lg border-l-4 ${borderColor} bg-card p-4 transition-shadow hover:shadow-md ${
        isBreaking ? "ring-2 ring-amber-400/50 bg-amber-50/5" : ""
      }`}
    >
      <div className="flex gap-3">
        {/* Board avatar */}
        {showBoard && boardCode && (
          <div className="shrink-0 pt-0.5">
            <div
              className={`flex size-10 items-center justify-center rounded-lg ${board.bg} ${board.text} text-xs font-bold shadow-sm`}
              title={boardName ?? boardCode}
            >
              {board.initials}
            </div>
          </div>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant={badgeVariant} className="text-xs">
                {label}
              </Badge>
              {showBoard && boardCode && (
                <span className="text-xs font-medium text-muted-foreground">
                  {boardCode}
                </span>
              )}
              {isBreaking && (
                <Badge variant="destructive" className="text-xs">
                  Breaking
                </Badge>
              )}
              {priority === "high" && !isBreaking && (
                <Badge variant="destructive" className="text-xs opacity-80">
                  High Priority
                </Badge>
              )}
            </div>
            <span className="shrink-0 text-xs text-muted-foreground">
              {relativeTime(publishedAt)}
            </span>
          </div>

          <h3 className="mt-1.5 text-sm font-semibold leading-tight">
            {slug ? (
              <Link
                href={`/notifications/${slug}`}
                className="hover:text-violet-600 hover:underline"
              >
                {title}
              </Link>
            ) : (
              title
            )}
          </h3>

          {summary && (
            <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
              {summary}
            </p>
          )}

          {pdfUrl && (
            <a
              href={pdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-xs text-violet-600 hover:underline"
            >
              <FileDown className="size-3" />
              Download PDF
              <ExternalLink className="size-3" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
