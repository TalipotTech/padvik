"use client";

import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { BadgeCheck, Users, FolderOpen, Star } from "lucide-react";

export interface CreatorCardProps {
  userId: number;
  displayName: string;
  institution?: string | null;
  institutionType?: string | null;
  avatarUrl?: string | null;
  isVerified?: boolean;
  isFeatured?: boolean;
  followerCount: number;
  contentCount: number;
  publishedCount?: number;
  rating?: string | number | null;
  className?: string;
}

const TYPE_LABELS: Record<string, string> = {
  school: "School",
  tuition: "Tuition Center",
  independent: "Independent",
  publisher: "Publisher",
};

export function CreatorCard({
  userId,
  displayName,
  institution,
  institutionType,
  avatarUrl,
  isVerified,
  isFeatured,
  followerCount,
  contentCount,
  publishedCount,
  rating,
  className,
}: CreatorCardProps) {
  const initials = displayName
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <Link href={`/creators/${userId}`}>
      <Card className={`hover:border-primary/50 hover:shadow-md transition-all cursor-pointer h-full group ${className ?? ""}`}>
        <CardContent className="p-4 flex flex-col items-center text-center gap-2.5">
          {/* Avatar */}
          <Avatar className="h-14 w-14 ring-2 ring-primary/10 group-hover:ring-primary/30 transition-all">
            <AvatarImage src={avatarUrl ?? undefined} />
            <AvatarFallback className="text-sm font-bold bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-300">
              {initials}
            </AvatarFallback>
          </Avatar>

          {/* Name + verified */}
          <div className="space-y-0.5">
            <div className="flex items-center justify-center gap-1">
              <h3 className="text-sm font-semibold truncate max-w-[160px] group-hover:text-primary transition-colors">
                {displayName}
              </h3>
              {isVerified && <BadgeCheck className="h-3.5 w-3.5 text-violet-500 shrink-0" />}
            </div>
            {institution && (
              <p className="text-[10px] text-muted-foreground truncate max-w-[180px]">
                {institution}
              </p>
            )}
            {institutionType && (
              <Badge variant="outline" className="text-[9px]">
                {TYPE_LABELS[institutionType] || institutionType}
              </Badge>
            )}
          </div>

          {/* Stats */}
          <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-0.5">
              <Users className="h-3 w-3" />
              {Number(followerCount).toLocaleString()}
            </span>
            <span className="flex items-center gap-0.5">
              <FolderOpen className="h-3 w-3" />
              {publishedCount ?? contentCount}
            </span>
            {rating && Number(rating) > 0 && (
              <span className="flex items-center gap-0.5">
                <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                {Number(rating).toFixed(1)}
              </span>
            )}
          </div>

          {/* Featured badge */}
          {isFeatured && (
            <Badge className="text-[9px] bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-300 border-0">
              Featured
            </Badge>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
