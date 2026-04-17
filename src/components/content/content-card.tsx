"use client";

import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  FileVideo, FileAudio, FileText, Image as ImageIcon,
  Eye, ThumbsUp, BadgeCheck, Crown,
} from "lucide-react";

export interface ContentCardProps {
  id: number;
  title: string;
  contentType: string;
  description?: string | null;
  thumbnailUrl?: string | null;
  durationSeconds?: number | null;
  isPremium?: boolean;
  viewCount?: number | null;
  likeCount?: number | null;
  publishedAt?: string | null;
  creatorName?: string | null;
  creatorAvatar?: string | null;
  creatorVerified?: boolean;
  creatorId?: number;
  /** Override link target. Defaults to /content/{id} */
  href?: string;
  className?: string;
}

const TYPE_COLORS: Record<string, string> = {
  video: "from-blue-500/20 to-blue-600/10",
  audio: "from-green-500/20 to-green-600/10",
  image: "from-amber-500/20 to-amber-600/10",
  document: "from-red-500/20 to-red-600/10",
  note: "from-violet-500/20 to-violet-600/10",
  question_set: "from-pink-500/20 to-pink-600/10",
};

function TypeIcon({ type, className }: { type: string; className?: string }) {
  const cls = className || "h-6 w-6";
  switch (type) {
    case "video": return <FileVideo className={`${cls} text-blue-500`} />;
    case "audio": return <FileAudio className={`${cls} text-green-500`} />;
    case "image": return <ImageIcon className={`${cls} text-amber-500`} />;
    case "document": return <FileText className={`${cls} text-red-500`} />;
    default: return <FileText className={`${cls} text-violet-500`} />;
  }
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export function ContentCard({
  id,
  title,
  contentType,
  thumbnailUrl,
  durationSeconds,
  isPremium,
  viewCount,
  likeCount,
  publishedAt,
  creatorName,
  creatorAvatar,
  creatorVerified,
  href,
  className,
}: ContentCardProps) {
  const linkHref = href || `/content/${id}`;
  const gradient = TYPE_COLORS[contentType] || TYPE_COLORS.note;

  return (
    <Link href={linkHref}>
      <Card className={`hover:border-primary/50 hover:shadow-md transition-all cursor-pointer h-full group overflow-hidden ${className ?? ""}`}>
        {/* Thumbnail area */}
        <div className={`relative aspect-video bg-gradient-to-br ${gradient} flex items-center justify-center`}>
          {thumbnailUrl ? (
            <img
              src={thumbnailUrl}
              alt={title}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          ) : (
            <TypeIcon type={contentType} className="h-10 w-10 opacity-60" />
          )}

          {/* Duration overlay */}
          {durationSeconds && durationSeconds > 0 && (
            <span className="absolute bottom-1.5 right-1.5 bg-black/70 text-white text-[10px] font-medium px-1.5 py-0.5 rounded">
              {formatDuration(durationSeconds)}
            </span>
          )}

          {/* Type badge */}
          <Badge className="absolute top-1.5 left-1.5 text-[10px] capitalize" variant="secondary">
            {contentType.replace("_", " ")}
          </Badge>

          {/* Premium badge */}
          {isPremium && (
            <span className="absolute top-1.5 right-1.5 flex items-center gap-0.5 bg-amber-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded">
              <Crown className="h-3 w-3" /> PRO
            </span>
          )}
        </div>

        <CardContent className="p-3 space-y-2">
          {/* Title */}
          <h3 className="text-sm font-semibold leading-tight line-clamp-2 group-hover:text-primary transition-colors">
            {title}
          </h3>

          {/* Creator row */}
          {creatorName && (
            <div className="flex items-center gap-1.5">
              <Avatar className="h-5 w-5">
                <AvatarImage src={creatorAvatar ?? undefined} />
                <AvatarFallback className="text-[8px]">
                  {creatorName.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <span className="text-[11px] text-muted-foreground truncate">{creatorName}</span>
              {creatorVerified && <BadgeCheck className="h-3 w-3 text-violet-500 shrink-0" />}
            </div>
          )}

          {/* Stats row */}
          <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
            {viewCount !== null && viewCount !== undefined && (
              <span className="flex items-center gap-0.5">
                <Eye className="h-3 w-3" /> {formatCount(Number(viewCount))}
              </span>
            )}
            {likeCount !== null && likeCount !== undefined && Number(likeCount) > 0 && (
              <span className="flex items-center gap-0.5">
                <ThumbsUp className="h-3 w-3" /> {formatCount(Number(likeCount))}
              </span>
            )}
            {publishedAt && (
              <span className="ml-auto">{timeAgo(publishedAt)}</span>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
