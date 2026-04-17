import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { creatorContent, creatorProfiles } from "@/db/schema/creators";
import { users } from "@/db/schema/auth";
import { boards, subjects, chapters } from "@/db/schema/curriculum";
import { eq, and, desc, ne } from "drizzle-orm";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { PadvikLogo } from "@/components/ui/padvik-logo";
import {
  BadgeCheck, Eye, ThumbsUp, Clock, FileVideo, FileAudio, FileText,
  Image as ImageIcon, LogIn, Users, Star, Crown,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Metadata for SEO
// ---------------------------------------------------------------------------

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const [item] = await db
    .select({ title: creatorContent.title, description: creatorContent.description, thumbnailUrl: creatorContent.thumbnailUrl })
    .from(creatorContent)
    .where(and(eq(creatorContent.id, Number(id)), eq(creatorContent.isPublished, true)))
    .limit(1);

  if (!item) return { title: "Content Not Found | Padvik" };

  return {
    title: `${item.title} | Padvik`,
    description: item.description ?? "Educational content on Padvik",
    openGraph: {
      title: item.title,
      description: item.description ?? undefined,
      images: item.thumbnailUrl ? [{ url: item.thumbnailUrl }] : undefined,
    },
  };
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function TypeIcon({ type, className }: { type: string; className?: string }) {
  const cls = className || "h-5 w-5";
  switch (type) {
    case "video": return <FileVideo className={`${cls} text-blue-500`} />;
    case "audio": return <FileAudio className={`${cls} text-green-500`} />;
    case "image": return <ImageIcon className={`${cls} text-amber-500`} />;
    default: return <FileText className={`${cls} text-violet-500`} />;
  }
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export default async function ContentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const contentId = Number(id);

  // If the user is already signed in, send them to the authenticated dashboard view
  // where they can view classroom content directly (instead of the public preview gate)
  const session = await auth();
  if (session?.user) {
    redirect(`/dashboard/content/${contentId}`);
  }

  // Fetch content with creator info
  const [item] = await db
    .select({
      id: creatorContent.id,
      title: creatorContent.title,
      description: creatorContent.description,
      contentType: creatorContent.contentType,
      thumbnailUrl: creatorContent.thumbnailUrl,
      durationSeconds: creatorContent.durationSeconds,
      isPremium: creatorContent.isPremium,
      language: creatorContent.language,
      viewCount: creatorContent.viewCount,
      likeCount: creatorContent.likeCount,
      avgRating: creatorContent.avgRating,
      publishedAt: creatorContent.publishedAt,
      aiSummary: creatorContent.aiSummary,
      aiTags: creatorContent.aiTags,
      creatorId: creatorContent.creatorId,
      boardId: creatorContent.boardId,
      subjectId: creatorContent.subjectId,
      creatorName: creatorProfiles.displayName,
      creatorInstitution: creatorProfiles.institution,
      creatorFollowers: creatorProfiles.followerCount,
      creatorRating: creatorProfiles.rating,
      creatorAvatar: users.avatarUrl,
      creatorVerified: users.creatorVerified,
      boardName: boards.name,
      subjectName: subjects.name,
      chapterTitle: chapters.title,
    })
    .from(creatorContent)
    .innerJoin(creatorProfiles, eq(creatorProfiles.userId, creatorContent.creatorId))
    .innerJoin(users, eq(users.id, creatorContent.creatorId))
    .leftJoin(boards, eq(boards.id, creatorContent.boardId))
    .leftJoin(subjects, eq(subjects.id, creatorContent.subjectId))
    .leftJoin(chapters, eq(chapters.id, creatorContent.chapterId))
    .where(and(eq(creatorContent.id, contentId), eq(creatorContent.isPublished, true)))
    .limit(1);

  if (!item) notFound();

  // Fetch related content (same board or subject, different id)
  const relatedConditions = [
    eq(creatorContent.isPublished, true),
    eq(creatorContent.reviewStatus, "approved"),
    ne(creatorContent.id, contentId),
  ];
  if (item.boardId) relatedConditions.push(eq(creatorContent.boardId, item.boardId));

  const related = await db
    .select({
      id: creatorContent.id,
      title: creatorContent.title,
      contentType: creatorContent.contentType,
      thumbnailUrl: creatorContent.thumbnailUrl,
      durationSeconds: creatorContent.durationSeconds,
      isPremium: creatorContent.isPremium,
      viewCount: creatorContent.viewCount,
      likeCount: creatorContent.likeCount,
      publishedAt: creatorContent.publishedAt,
      creatorName: creatorProfiles.displayName,
      creatorAvatar: users.avatarUrl,
      creatorVerified: users.creatorVerified,
      creatorId: creatorContent.creatorId,
    })
    .from(creatorContent)
    .innerJoin(creatorProfiles, eq(creatorProfiles.userId, creatorContent.creatorId))
    .innerJoin(users, eq(users.id, creatorContent.creatorId))
    .where(and(...relatedConditions))
    .orderBy(desc(creatorContent.viewCount))
    .limit(4);

  const TYPE_GRADIENTS: Record<string, string> = {
    video: "from-blue-500/20 to-blue-600/10",
    audio: "from-green-500/20 to-green-600/10",
    image: "from-amber-500/20 to-amber-600/10",
    document: "from-red-500/20 to-red-600/10",
    note: "from-violet-500/20 to-violet-600/10",
    question_set: "from-pink-500/20 to-pink-600/10",
  };

  const gradient = TYPE_GRADIENTS[item.contentType] || TYPE_GRADIENTS.note;

  return (
    <div className="min-h-screen bg-background">
      {/* Navbar */}
      <nav className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
          <Link href="/">
            <PadvikLogo size="md" />
          </Link>
          <div className="flex items-center gap-3">
            <Link href="/explore">
              <Button variant="ghost" size="sm">Explore</Button>
            </Link>
            <Link href="/login">
              <Button size="sm" className="gap-1.5">
                <LogIn className="h-4 w-4" /> Sign In
              </Button>
            </Link>
          </div>
        </div>
      </nav>

      <div className="mx-auto max-w-5xl px-4 py-8">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-6">
          <Link href="/" className="hover:text-foreground">Home</Link>
          <span>/</span>
          <Link href="/explore" className="hover:text-foreground">Explore</Link>
          <span>/</span>
          <span className="text-foreground truncate max-w-[200px]">{item.title}</span>
        </div>

        <div className="grid gap-8 lg:grid-cols-3">
          {/* Main content */}
          <div className="lg:col-span-2 space-y-6">
            {/* Thumbnail / Preview */}
            <div className={`relative aspect-video rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center overflow-hidden`}>
              {item.thumbnailUrl ? (
                <img src={item.thumbnailUrl} alt={item.title} className="w-full h-full object-cover" />
              ) : (
                <TypeIcon type={item.contentType} className="h-16 w-16 opacity-40" />
              )}
              {/* Gated overlay */}
              <div className="absolute inset-0 bg-black/40 flex flex-col items-center justify-center text-white">
                <LogIn className="h-10 w-10 mb-3 opacity-80" />
                <p className="font-semibold text-lg">Sign up to access this content</p>
                <Link href="/login">
                  <Button className="mt-3 gap-1.5">
                    <LogIn className="h-4 w-4" /> Get Started Free
                  </Button>
                </Link>
              </div>
              {item.isPremium && (
                <span className="absolute top-3 right-3 flex items-center gap-1 bg-amber-500 text-white text-xs font-bold px-2 py-1 rounded z-10">
                  <Crown className="h-3.5 w-3.5" /> Premium
                </span>
              )}
              {item.durationSeconds && Number(item.durationSeconds) > 0 && (
                <span className="absolute bottom-3 right-3 bg-black/70 text-white text-xs px-2 py-0.5 rounded z-10">
                  <Clock className="inline h-3 w-3 mr-1" />
                  {Math.floor(Number(item.durationSeconds) / 60)}:{String(Number(item.durationSeconds) % 60).padStart(2, "0")}
                </span>
              )}
            </div>

            {/* Title + badges */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Badge variant="secondary" className="capitalize">{item.contentType.replace("_", " ")}</Badge>
                {item.boardName && <Badge variant="outline">{item.boardName}</Badge>}
                {item.subjectName && <Badge variant="outline">{item.subjectName}</Badge>}
                {item.chapterTitle && <Badge variant="outline">{item.chapterTitle}</Badge>}
              </div>
              <h1 className="text-2xl font-bold">{item.title}</h1>
            </div>

            {/* Stats */}
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <span className="flex items-center gap-1"><Eye className="h-4 w-4" /> {formatCount(Number(item.viewCount ?? 0))} views</span>
              {Number(item.likeCount ?? 0) > 0 && <span className="flex items-center gap-1"><ThumbsUp className="h-4 w-4" /> {formatCount(Number(item.likeCount ?? 0))}</span>}
              {item.publishedAt && <span>{new Date(item.publishedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</span>}
            </div>

            {/* Description */}
            {item.description && (
              <div className="prose prose-sm max-w-none dark:prose-invert">
                <p>{item.description}</p>
              </div>
            )}

            {/* AI Summary */}
            {item.aiSummary && (
              <div className="rounded-lg border bg-muted/30 p-4">
                <p className="text-xs font-semibold text-muted-foreground mb-1.5">AI Summary</p>
                <p className="text-sm">{item.aiSummary}</p>
              </div>
            )}

            {/* Tags */}
            {item.aiTags && item.aiTags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {item.aiTags.map((tag) => (
                  <Badge key={tag} variant="outline" className="text-[10px]">{tag}</Badge>
                ))}
              </div>
            )}
          </div>

          {/* Sidebar — Creator info */}
          <div className="space-y-6">
            <div className="rounded-xl border p-5 space-y-4">
              <Link href={`/creators/${item.creatorId}`} className="flex items-center gap-3 group">
                <Avatar className="h-12 w-12">
                  <AvatarImage src={item.creatorAvatar ?? undefined} />
                  <AvatarFallback className="bg-violet-100 text-violet-700 font-bold">
                    {item.creatorName.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <div className="flex items-center gap-1">
                    <span className="font-semibold group-hover:text-primary transition-colors">{item.creatorName}</span>
                    {item.creatorVerified && <BadgeCheck className="h-4 w-4 text-violet-500" />}
                  </div>
                  {item.creatorInstitution && (
                    <p className="text-xs text-muted-foreground">{item.creatorInstitution}</p>
                  )}
                </div>
              </Link>

              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5" /> {formatCount(Number(item.creatorFollowers ?? 0))} followers</span>
                {item.creatorRating && Number(item.creatorRating) > 0 && (
                  <span className="flex items-center gap-1">
                    <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                    {Number(item.creatorRating).toFixed(1)}
                  </span>
                )}
              </div>

              <Link href={`/creators/${item.creatorId}`}>
                <Button variant="outline" className="w-full" size="sm">View Profile</Button>
              </Link>
            </div>

            {/* CTA Card */}
            <div className="rounded-xl border-2 border-primary/30 bg-primary/5 p-5 text-center space-y-3">
              <p className="font-semibold">Want to access this content?</p>
              <p className="text-xs text-muted-foreground">Sign up for free and join a classroom to start learning.</p>
              <Link href="/login">
                <Button className="w-full gap-1.5">
                  <LogIn className="h-4 w-4" /> Sign Up Free
                </Button>
              </Link>
            </div>
          </div>
        </div>

        {/* Related Content */}
        {related.length > 0 && (
          <div className="mt-12">
            <h2 className="text-lg font-semibold mb-4">Related Content</h2>
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
              {related.map((r) => (
                <RelatedCard key={r.id} {...r} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="border-t py-8 mt-12">
        <div className="mx-auto max-w-7xl px-4 flex items-center justify-between">
          <PadvikLogo size="sm" />
          <p className="text-xs text-muted-foreground">&copy; {new Date().getFullYear()} Ensate Technologies.</p>
        </div>
      </footer>
    </div>
  );
}

// Inline related card using same structure as ContentCard but server-rendered
function RelatedCard(props: {
  id: number; title: string; contentType: string; thumbnailUrl: string | null;
  viewCount: unknown; creatorName: string; creatorAvatar: string | null; creatorVerified: boolean | null;
}) {
  const TYPE_GRADIENTS: Record<string, string> = {
    video: "from-blue-500/20 to-blue-600/10",
    audio: "from-green-500/20 to-green-600/10",
    image: "from-amber-500/20 to-amber-600/10",
    document: "from-red-500/20 to-red-600/10",
    note: "from-violet-500/20 to-violet-600/10",
  };
  const gradient = TYPE_GRADIENTS[props.contentType] || TYPE_GRADIENTS.note;

  return (
    <Link href={`/content/${props.id}`}>
      <div className="rounded-lg border hover:border-primary/50 hover:shadow-md transition-all cursor-pointer overflow-hidden">
        <div className={`aspect-video bg-gradient-to-br ${gradient} flex items-center justify-center`}>
          {props.thumbnailUrl ? (
            <img src={props.thumbnailUrl} alt={props.title} className="w-full h-full object-cover" />
          ) : (
            <TypeIcon type={props.contentType} className="h-8 w-8 opacity-40" />
          )}
        </div>
        <div className="p-3">
          <h3 className="text-sm font-semibold line-clamp-2">{props.title}</h3>
          <div className="flex items-center gap-1.5 mt-1.5">
            <Avatar className="h-4 w-4">
              <AvatarImage src={props.creatorAvatar ?? undefined} />
              <AvatarFallback className="text-[7px]">{props.creatorName.charAt(0)}</AvatarFallback>
            </Avatar>
            <span className="text-[10px] text-muted-foreground truncate">{props.creatorName}</span>
            <span className="text-[10px] text-muted-foreground ml-auto flex items-center gap-0.5">
              <Eye className="h-3 w-3" /> {formatCount(Number(props.viewCount ?? 0))}
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}
