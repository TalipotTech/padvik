import { Play, Activity, Sparkles, FileText, BookOpen } from "lucide-react";

/**
 * Shared content-type icon — lifted from dashboard-home so the search results
 * and other content lists render the same iconography.
 */
export function ContentTypeIcon({ type, className }: { type: string; className?: string }) {
  const cls = className ?? "h-3.5 w-3.5 shrink-0";
  switch (type) {
    case "video":
      return <Play className={`${cls} text-blue-500`} />;
    case "audio":
      return <Activity className={`${cls} text-green-500`} />;
    case "image":
      return <Sparkles className={`${cls} text-amber-500`} />;
    case "document":
      return <FileText className={`${cls} text-red-500`} />;
    default:
      return <BookOpen className={`${cls} text-violet-500`} />;
  }
}
