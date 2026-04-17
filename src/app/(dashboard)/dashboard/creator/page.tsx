"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Users,
  FolderOpen,
  Eye,
  Inbox,
  Upload,
  Settings,
  Loader2,
  FileText,
  BarChart3,
  ClipboardList,
  MessageSquare,
  GraduationCap,
  FileVideo,
  FileAudio,
  Image as ImageIcon,
  ChevronRight,
  BookOpen,
  HelpCircle,
} from "lucide-react";

interface CreatorProfile {
  displayName: string;
  bio: string | null;
  followerCount: number;
  contentCount: number;
  creatorTier: string | null;
  creatorVerified: boolean;
}

interface ContentItem {
  id: number;
  contentType: string;
  title: string;
  description: string | null;
  thumbnailUrl: string | null;
  mediaUrl: string | null;
  isPublished: boolean;
  reviewStatus: string;
  viewCount: number;
  likeCount: number;
  createdAt: string;
  boardName: string | null;
  boardCode: string | null;
  standardGrade: number | null;
  subjectName: string | null;
  chapterTitle: string | null;
  chapterNumber: number | null;
  metadata: { mediaItems?: { type: string }[] } | null;
  doubtCount: number;
}

function ContentTypeIcon({ type, className }: { type: string; className?: string }) {
  const cls = className || "h-5 w-5";
  switch (type) {
    case "video": return <FileVideo className={cls} />;
    case "audio": return <FileAudio className={cls} />;
    case "image": return <ImageIcon className={cls} />;
    default: return <FileText className={cls} />;
  }
}

interface RecentDoubt {
  id: number; studentName: string; studentAvatar: string | null;
  questionText: string; status: string; createdAt: string;
}

export default function CreatorHubPage() {
  const [profile, setProfile] = useState<CreatorProfile | null>(null);
  const [recentContent, setRecentContent] = useState<ContentItem[]>([]);
  const [recentDoubts, setRecentDoubts] = useState<RecentDoubt[]>([]);
  const [unreadDoubts, setUnreadDoubts] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/creators/profile").then((r) => r.json()),
      fetch("/api/creators/content?limit=5").then((r) => r.json()),
      fetch("/api/doubts/inbox?limit=5").then((r) => r.json()),
      fetch("/api/doubts/unread-count").then((r) => r.json()),
    ])
      .then(([profileRes, contentRes, doubtsRes, unreadRes]) => {
        if (profileRes.success) setProfile(profileRes.data);
        if (contentRes.success) setRecentContent(contentRes.data.items);
        if (doubtsRes.success) setRecentDoubts(doubtsRes.data.items || []);
        if (unreadRes.success) setUnreadDoubts(unreadRes.data.count || 0);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!profile) {
    return <p className="text-muted-foreground py-10 text-center">Could not load creator profile.</p>;
  }

  return (
    <div className="space-y-6">
      {/* Profile Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{profile.displayName}</h1>
          <div className="flex items-center gap-2 mt-1">
            <Badge variant="secondary" className="capitalize">{profile.creatorTier || "free"} plan</Badge>
            {profile.creatorVerified && <Badge variant="default">Verified</Badge>}
          </div>
        </div>
        <Link href="/dashboard/creator/profile">
          <Button variant="outline" size="sm" className="gap-2">
            <Settings className="h-4 w-4" />
            Edit Profile
          </Button>
        </Link>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Followers</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{profile.followerCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Content Published</CardTitle>
            <FolderOpen className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{profile.contentCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Views</CardTitle>
            <Eye className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">—</div>
            <p className="text-xs text-muted-foreground">Coming soon</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pending Doubts</CardTitle>
            <Inbox className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${unreadDoubts > 0 ? "text-red-500" : ""}`}>{unreadDoubts}</div>
            <p className="text-xs text-muted-foreground">{unreadDoubts > 0 ? "Needs your response" : "All caught up"}</p>
          </CardContent>
        </Card>
      </div>

      {/* Content Quick Actions */}
      <div>
        <h2 className="text-lg font-semibold mb-3">Content</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Link href="/dashboard/creator/content/upload">
            <Card className="hover:border-primary/50 transition-colors cursor-pointer">
              <CardContent className="flex items-center gap-3 py-6">
                <Upload className="h-8 w-8 text-primary" />
                <div>
                  <p className="font-medium">Upload Content</p>
                  <p className="text-sm text-muted-foreground">Videos, notes, PDFs, images</p>
                </div>
              </CardContent>
            </Card>
          </Link>
          <Link href="/dashboard/creator/content">
            <Card className="hover:border-primary/50 transition-colors cursor-pointer">
              <CardContent className="flex items-center gap-3 py-6">
                <FolderOpen className="h-8 w-8 text-primary" />
                <div>
                  <p className="font-medium">Manage Content</p>
                  <p className="text-sm text-muted-foreground">Edit, publish, review</p>
                </div>
              </CardContent>
            </Card>
          </Link>
          <Link href="/dashboard/creator/doubts">
            <Card className="hover:border-primary/50 transition-colors cursor-pointer">
              <CardContent className="flex items-center gap-3 py-6">
                <Inbox className="h-8 w-8 text-primary" />
                <div>
                  <p className="font-medium">Doubt Inbox</p>
                  <p className="text-sm text-muted-foreground">Answer student questions</p>
                </div>
              </CardContent>
            </Card>
          </Link>
        </div>
      </div>

      {/* Recent My Contents */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Recent Content</h2>
          {recentContent.length > 0 && (
            <Link href="/dashboard/creator/content">
              <Button variant="ghost" size="sm" className="gap-1 text-xs">
                View all <ChevronRight className="h-3 w-3" />
              </Button>
            </Link>
          )}
        </div>
        {recentContent.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12 gap-3">
              <FolderOpen className="h-10 w-10 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No content yet. Upload your first lesson!</p>
              <Link href="/dashboard/creator/content/upload">
                <Button size="sm" variant="outline" className="gap-1.5">
                  <Upload className="h-3.5 w-3.5" />
                  Upload Content
                </Button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {recentContent.map((item) => (
              <Link key={item.id} href={`/dashboard/creator/content/${item.id}`}>
                <Card className="hover:border-primary/30 transition-colors cursor-pointer">
                  <CardContent className="flex items-center gap-4 py-3">
                    {/* Left: Preview icon/thumbnail */}
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-muted/50 border overflow-hidden">
                      {item.thumbnailUrl ? (
                        <img
                          src={item.thumbnailUrl}
                          alt={item.title}
                          className="h-full w-full object-cover"
                        />
                      ) : item.mediaUrl && item.contentType === "image" ? (
                        <img
                          src={item.mediaUrl}
                          alt={item.title}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <ContentTypeIcon type={item.contentType} className="h-6 w-6 text-muted-foreground" />
                      )}
                    </div>

                    {/* Right: Metadata */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{item.title}</p>
                      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                        <Badge variant="outline" className="text-[10px] capitalize py-0 h-5">
                          {item.contentType}
                        </Badge>
                        <Badge
                          variant={item.isPublished ? "default" : "secondary"}
                          className="text-[10px] py-0 h-5"
                        >
                          {item.isPublished ? "Published" : "Draft"}
                        </Badge>
                        {(item.metadata?.mediaItems?.length ?? 0) > 0 && (
                          <Badge variant="outline" className="text-[10px] py-0 h-5">
                            {item.metadata!.mediaItems!.length} file{item.metadata!.mediaItems!.length !== 1 ? "s" : ""}
                          </Badge>
                        )}
                        <span className="text-[10px] text-muted-foreground">
                          {item.viewCount} views
                        </span>
                        {(item.doubtCount || 0) > 0 && (
                          <Link href="/dashboard/creator/doubts" onClick={e => e.stopPropagation()}>
                            <Badge variant="destructive" className="text-[10px] py-0 h-5 gap-0.5 cursor-pointer hover:bg-destructive/80">
                              <HelpCircle className="h-2.5 w-2.5" />{item.doubtCount}
                            </Badge>
                          </Link>
                        )}
                      </div>
                      {/* Curriculum info */}
                      {(item.boardCode || item.subjectName) && (
                        <div className="flex items-center gap-1 mt-0.5">
                          <BookOpen className="h-3 w-3 text-muted-foreground shrink-0" />
                          <span className="text-[11px] text-muted-foreground truncate">
                            {[
                              item.boardCode,
                              item.standardGrade ? `Class ${item.standardGrade}` : null,
                              item.subjectName,
                              item.chapterTitle ? `Ch ${item.chapterNumber}: ${item.chapterTitle}` : null,
                            ].filter(Boolean).join(" · ")}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Date */}
                    <span className="text-xs text-muted-foreground shrink-0">
                      {new Date(item.createdAt).toLocaleDateString()}
                    </span>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Recent Doubts */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            Recent Doubts
            {unreadDoubts > 0 && (
              <Badge variant="destructive" className="text-xs">{unreadDoubts} new</Badge>
            )}
          </h2>
          {recentDoubts.length > 0 && (
            <Link href="/dashboard/creator/doubts">
              <Button variant="ghost" size="sm" className="gap-1 text-xs">
                View all <ChevronRight className="h-3 w-3" />
              </Button>
            </Link>
          )}
        </div>
        {recentDoubts.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-8 gap-2">
              <Inbox className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No doubts yet</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {recentDoubts.map((d) => (
              <Link key={d.id} href={`/dashboard/doubts/${d.id}`}>
                <Card className={`hover:border-primary/30 transition-colors cursor-pointer ${d.status === "open" ? "border-red-200 dark:border-red-800" : ""}`}>
                  <CardContent className="flex items-center gap-3 py-3">
                    <Avatar className="h-8 w-8 shrink-0">
                      <AvatarImage src={d.studentAvatar || undefined} />
                      <AvatarFallback className="text-xs">{d.studentName?.[0] || "S"}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{d.studentName}</span>
                        <Badge
                          variant={d.status === "open" ? "destructive" : d.status === "creator_answered" ? "default" : "outline"}
                          className="text-[10px] py-0 h-5"
                        >
                          {d.status === "open" ? "Needs Response" : d.status === "ai_answered" ? "AI Answered" : d.status === "creator_answered" ? "Responded" : d.status}
                        </Badge>
                        {d.status === "open" && <div className="h-2 w-2 rounded-full bg-red-500" />}
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{d.questionText}</p>
                    </div>
                    <span className="text-[10px] text-muted-foreground shrink-0">{new Date(d.createdAt).toLocaleDateString()}</span>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Teaching Tools */}
      <div>
        <h2 className="text-lg font-semibold mb-3">Teaching Tools</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {[
            { href: "/dashboard/question-bank", icon: ClipboardList, label: "Question Bank", color: "text-violet-500" },
            { href: "/dashboard/exams", icon: FileText, label: "Create Exam", color: "text-orange-500" },
            { href: "/dashboard/classroom", icon: GraduationCap, label: "Classrooms", color: "text-blue-500" },
            { href: "/dashboard/analytics", icon: BarChart3, label: "Analytics", color: "text-green-500" },
            { href: "/dashboard/chat", icon: MessageSquare, label: "AI Chat", color: "text-pink-500" },
          ].map((action) => (
            <Link key={action.href} href={action.href}>
              <Card className="hover:border-primary/30 transition-colors cursor-pointer h-full">
                <CardContent className="flex flex-col items-center justify-center py-6 gap-2">
                  <action.icon className={`h-7 w-7 ${action.color}`} />
                  <p className="text-sm font-medium text-center">{action.label}</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
