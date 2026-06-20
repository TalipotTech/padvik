"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  BookOpen,
  FileText,
  MessageSquare,
  Sparkles,
  Users,
  ClipboardList,
  BarChart3,
  Upload,
  UserCheck,
  Layers,
  Settings,
  Activity,
  CheckSquare,
  Cpu,
  Database,
  HelpCircle,
  GraduationCap,
  BookMarked,
  Bell,
  Play,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BoardPicker } from "@/components/layout/board-picker";
import { Skeleton } from "@/components/ui/skeleton";
import { useBoardSelection } from "@/hooks/use-board-selection";
import { useData } from "@/hooks/use-data";
import { getSubjects } from "@/lib/data";
import { DashboardNotifications } from "@/components/notifications/DashboardNotifications";
import { markClassroomsSeen } from "@/components/classrooms/new-content-badge";
import { ContentCard, type ContentCardProps } from "@/components/content/content-card";

interface DashboardHomeProps {
  userName: string;
  userRole: string;
}

const studentActions = [
  { href: "/dashboard/syllabus", label: "Curriculum", icon: BookOpen, color: "text-violet-600", desc: "Browse textbooks & study material" },
  { href: "/dashboard/learn", label: "My Learning", icon: GraduationCap, color: "text-emerald-600", desc: "Continue where you left off" },
  { href: "__playground__", label: "Playground", icon: Play, color: "text-pink-600", desc: "Jump to your last topic" },
  { href: "/dashboard/learn/journal", label: "Study Journal", icon: BookMarked, color: "text-amber-600", desc: "Notes, chats, videos & exams" },
  { href: "/dashboard/chat", label: "Ask AI", icon: Sparkles, color: "text-blue-600", desc: "Ask anything about your subjects" },
];

const teacherActions = [
  { href: "/dashboard/classroom", label: "My Classrooms", icon: Users, color: "text-primary" },
  { href: "/dashboard/question-bank", label: "Question Bank", icon: ClipboardList, color: "text-violet-600" },
  { href: "/dashboard/exams", label: "Create Exam", icon: FileText, color: "text-orange-600" },
  { href: "/dashboard/analytics", label: "Class Analytics", icon: BarChart3, color: "text-blue-600" },
];

const adminActions = [
  { href: "/admin/pipeline", label: "Pipeline Overview", icon: Activity, color: "text-primary" },
  { href: "/scrape-jobs", label: "Scrape Pipeline", icon: Upload, color: "text-violet-600" },
  { href: "/admin/content-review", label: "Content Review", icon: CheckSquare, color: "text-orange-600" },
  { href: "/admin/ai-providers", label: "AI Providers", icon: Cpu, color: "text-blue-600" },
  { href: "/admin/notification-scraper", label: "Notifications", icon: Bell, color: "text-pink-600" },
  { href: "/curriculum", label: "Curriculum Explorer", icon: Layers, color: "text-emerald-600" },
  { href: "/schools", label: "Schools Directory", icon: GraduationCap, color: "text-teal-600" },
  { href: "/dashboard/settings", label: "Settings", icon: Settings, color: "text-muted-foreground" },
];

const parentActions = [
  { href: "/dashboard/analytics", label: "View Progress", icon: BarChart3, color: "text-primary" },
  { href: "/dashboard/syllabus", label: "Browse Syllabus", icon: BookOpen, color: "text-emerald-600" },
  { href: "/dashboard/exams", label: "Exam Results", icon: FileText, color: "text-orange-600" },
  { href: "/dashboard/settings", label: "Settings", icon: UserCheck, color: "text-blue-600" },
];

function getActionsForRole(role: string) {
  switch (role) {
    case "creator": return teacherActions;
    case "teacher": return teacherActions;
    case "admin": return adminActions;
    case "parent": return parentActions;
    default: return studentActions;
  }
}

function getRoleLabel(role: string) {
  switch (role) {
    case "creator": return "Creator";
    case "teacher": return "Teacher";
    case "admin": return "Administrator";
    case "parent": return "Parent";
    default: return "Student";
  }
}

export function DashboardHome({ userName, userRole }: DashboardHomeProps) {
  const { boardId, boardName, grade } = useBoardSelection();
  const [pickerOpen, setPickerOpen] = useState(false);

  // Board selection is now handled via the CTA banner below — no forced dialog popup

  const firstName = userName.split(" ")[0].split("@")[0];
  const quickActions = getActionsForRole(userRole);

  const { data: subjects, loading: subjectsLoading } = useData(
    () => boardId && grade ? getSubjects(boardId, grade) : Promise.resolve([]),
    [boardId, grade],
  );

  // Fetch continue learning data
  const [continueData, setContinueData] = useState<Array<{
    subject_name: string; latest_topic_id: number; latest_topic_title: string;
    latest_chapter_title: string; avg_completion: number;
  }>>([]);
  useEffect(() => {
    if (!boardId || !grade) return;
    fetch(`/api/learn/dashboard?boardId=${boardId}&grade=${grade}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (json?.success) {
          const items = (json.data.subjectProgress ?? [])
            .filter((s: { latest_topic_id: number | null }) => s.latest_topic_id)
            .slice(0, 3);
          setContinueData(items);
        }
      })
      .catch(() => {});
  }, [boardId, grade]);

  // Fetch classroom feed for students
  interface ClassroomFeedItem {
    id: number;
    name: string;
    teacherName: string | null;
    teacherAvatar: string | null;
    content: Array<{
      id: number;
      title: string;
      contentType: string;
      thumbnailUrl: string | null;
      aiSummary: string | null;
      createdAt: string;
    }>;
  }
  const [classroomFeed, setClassroomFeed] = useState<ClassroomFeedItem[]>([]);
  const [classroomFeedLoading, setClassroomFeedLoading] = useState(false);
  useEffect(() => {
    if (userRole !== "student") return;
    setClassroomFeedLoading(true);
    fetch("/api/my/classroom-feed")
      .then((r) => r.json())
      .then((json) => {
        if (json.success) setClassroomFeed(json.data.classrooms ?? []);
      })
      .catch(() => {})
      .finally(() => setClassroomFeedLoading(false));
  }, [userRole]);

  // Fetch trending content for students (discover section)
  const [discoverContent, setDiscoverContent] = useState<ContentCardProps[]>([]);
  useEffect(() => {
    if (userRole !== "student") return;
    const params = boardId ? `?boardId=${boardId}&limit=6` : "?limit=6";
    fetch(`/api/content/featured${params}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.success) {
          setDiscoverContent(
            (json.data.items ?? []).map((c: Record<string, unknown>) => ({
              id: c.id as number,
              title: c.title as string,
              contentType: c.contentType as string,
              thumbnailUrl: c.thumbnailUrl as string | null,
              durationSeconds: c.durationSeconds as number | null,
              isPremium: c.isPremium as boolean,
              viewCount: Number(c.viewCount ?? 0),
              likeCount: Number(c.likeCount ?? 0),
              publishedAt: c.publishedAt as string,
              creatorName: c.creatorName as string,
              creatorAvatar: c.creatorAvatar as string | null,
              creatorVerified: c.creatorVerified as boolean,
              creatorId: c.creatorId as number,
            }))
          );
        }
      })
      .catch(() => {});
  }, [userRole, boardId]);

  return (
    <div className="space-y-6 pt-2">
      {/* Welcome banner */}
      <div className="rounded-xl bg-gradient-to-r from-primary/10 via-primary/5 to-transparent border p-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground sm:text-3xl">
              Welcome back, {firstName}!
            </h1>
            <div className="flex items-center gap-2 mt-1">
              <Badge variant="secondary" className="text-xs">
                {getRoleLabel(userRole)}
              </Badge>
              {boardName && grade && (
                <span className="text-sm text-muted-foreground">
                  {boardName} · Class {grade}
                </span>
              )}
            </div>
          </div>
          {(userRole === "student" || userRole === "teacher" || userRole === "creator") && boardName && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPickerOpen(true)}
              className="shrink-0"
            >
              Change
            </Button>
          )}
        </div>
      </div>

      {/* Onboarding CTA — shown when board/grade not set */}
      {!boardId && (userRole === "student" || userRole === "teacher" || userRole === "creator") && (
        <div className="rounded-xl border-2 border-primary/30 bg-primary/5 p-6">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 shrink-0">
              <GraduationCap className="h-6 w-6 text-primary" />
            </div>
            <div className="flex-1">
              <h2 className="text-lg font-semibold">Set up your profile</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Select your education board and class to see relevant content, subjects, and exam papers tailored for you.
              </p>
              <div className="flex gap-3 mt-4">
                <Button onClick={() => setPickerOpen(true)} className="gap-2">
                  <GraduationCap className="h-4 w-4" />
                  Select Board &amp; Class
                </Button>
                <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => {
                  // Skip — just dismiss (will show again next visit until they set it)
                }}>
                  Skip for now
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Continue Learning — shown at top for students */}
      {continueData.length > 0 && (userRole === "student" || userRole === "teacher" || userRole === "creator") && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <div className="h-2.5 w-2.5 rounded-full bg-amber-500 animate-pulse" />
              Continue Learning
            </h2>
            <Link href="/dashboard/learn" className="text-xs text-violet-600 hover:underline">
              View all
            </Link>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {continueData.map((item) => (
              <Link key={item.latest_topic_id} href={`/dashboard/learn/${item.latest_topic_id}`}>
                <Card className="hover:border-primary/50 hover:shadow-md transition-all cursor-pointer h-full">
                  <CardContent className="p-3">
                    <Badge variant="secondary" className="text-[10px] mb-1.5">{item.subject_name}</Badge>
                    <p className="text-xs font-medium truncate">{item.latest_topic_title}</p>
                    <p className="text-[10px] text-muted-foreground truncate">{item.latest_chapter_title}</p>
                    <div className="mt-2 flex items-center gap-2">
                      <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full bg-violet-500 transition-all"
                          style={{ width: `${Math.min(item.avg_completion ?? 0, 100)}%` }}
                        />
                      </div>
                      <span className="text-[10px] tabular-nums text-muted-foreground">{Math.round(item.avg_completion ?? 0)}%</span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* My Classrooms — for students */}
      {userRole === "student" && !classroomFeedLoading && classroomFeed.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <Users className="h-4 w-4 text-violet-600" />
              My Classrooms
            </h2>
            <Link href="/dashboard/classroom" className="text-xs text-violet-600 hover:underline">
              View all
            </Link>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {classroomFeed.slice(0, 3).map((cr) => (
              <Link key={cr.id} href={`/dashboard/classroom/${cr.id}`}>
                <Card className="hover:border-primary/50 hover:shadow-md transition-all cursor-pointer h-full">
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-100 dark:bg-violet-900/30">
                        <Users className="h-4 w-4 text-violet-600" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold truncate">{cr.name}</p>
                        <p className="text-[10px] text-muted-foreground truncate">by {cr.teacherName || "Teacher"}</p>
                      </div>
                    </div>
                    {cr.content.length > 0 ? (
                      <div className="space-y-1.5">
                        {cr.content.slice(0, 2).map((item) => (
                          <div key={item.id} className="flex items-center gap-2 text-xs">
                            <ContentTypeIcon type={item.contentType} />
                            <span className="truncate flex-1">{item.title}</span>
                            <span className="text-[10px] text-muted-foreground shrink-0">{timeAgo(item.createdAt)}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[11px] text-muted-foreground italic">No recent content</p>
                    )}
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Join a classroom CTA — for students with no classrooms */}
      {userRole === "student" && !classroomFeedLoading && classroomFeed.length === 0 && (
        <Card className="border-dashed border-violet-200 dark:border-violet-800">
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-100 dark:bg-violet-900/30">
              <Users className="h-5 w-5 text-violet-600" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium">Join a classroom</p>
              <p className="text-xs text-muted-foreground">Get content from your teachers and tutors</p>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link href="/dashboard/classroom">Join</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Discover Content — for students */}
      {userRole === "student" && discoverContent.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-violet-600" />
              Discover Content
              {boardName && <span className="text-[10px] font-normal text-muted-foreground">for {boardName}</span>}
            </h2>
            <Link href={boardId ? `/dashboard/explore?boardId=${boardId}` : "/dashboard/explore"} className="text-xs text-violet-600 hover:underline">
              Browse all
            </Link>
          </div>
          <div className="grid gap-3 grid-cols-2 sm:grid-cols-3">
            {discoverContent.slice(0, 6).map((item) => (
              <ContentCard key={item.id} {...item} href={`/dashboard/content/${item.id}`} />
            ))}
          </div>
        </div>
      )}

      {/* Quick actions — role-specific */}
      <div className={`grid gap-3 ${userRole === "admin" ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-6" : "grid-cols-2 sm:grid-cols-5"}`}>
        {quickActions.map((action) => {
          // Resolve Playground to last visited topic
          const href = action.href === "__playground__"
            ? (() => { try { const t = typeof window !== "undefined" ? localStorage.getItem("padvik-last-topic") : null; return t ? `/dashboard/learn/${t}` : "/dashboard/learn"; } catch { return "/dashboard/learn"; } })()
            : action.href;

          return (
            <Link key={action.label} href={href}>
              <Card className="hover:border-primary/50 hover:shadow-md transition-all cursor-pointer h-full group">
                <CardContent className="flex flex-col items-center gap-2.5 p-5 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted/80 group-hover:bg-primary/10 transition-colors">
                    <action.icon className={`h-6 w-6 ${action.color}`} />
                  </div>
                  <div>
                    <span className="text-sm font-semibold block">{action.label}</span>
                    {"desc" in action && (
                      <span className="text-[10px] text-muted-foreground mt-0.5 block leading-tight">
                        {(action as { desc: string }).desc}
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>

      {/* Board Notifications */}
      <DashboardNotifications />

      {/* Subjects overview — for students and teachers */}
      {(userRole === "student" || userRole === "teacher" || userRole === "creator") && (
        <>
          {subjectsLoading && boardId && (
            <div className="space-y-3">
              <h2 className="text-lg font-semibold text-foreground">
                {userRole === "teacher" || userRole === "creator" ? "Subjects" : "Your Subjects"}
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-24 rounded-lg" />
                ))}
              </div>
            </div>
          )}
          {(subjects ?? []).length > 0 && (
            <div className="space-y-3">
              <h2 className="text-lg font-semibold text-foreground">
                {userRole === "teacher" || userRole === "creator" ? "Subjects" : "Your Subjects"}
              </h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {(subjects ?? []).map((subject, i) => {
                  const colors = [
                    "from-violet-500/10 to-violet-600/5 border-violet-200",
                    "from-blue-500/10 to-blue-600/5 border-blue-200",
                    "from-emerald-500/10 to-emerald-600/5 border-emerald-200",
                    "from-amber-500/10 to-amber-600/5 border-amber-200",
                    "from-rose-500/10 to-rose-600/5 border-rose-200",
                    "from-cyan-500/10 to-cyan-600/5 border-cyan-200",
                    "from-indigo-500/10 to-indigo-600/5 border-indigo-200",
                    "from-orange-500/10 to-orange-600/5 border-orange-200",
                  ];
                  const colorClass = colors[i % colors.length];
                  return (
                    <Link key={subject.id} href={`/dashboard/syllabus?subjectId=${subject.id}`}>
                      <Card className={`bg-gradient-to-br ${colorClass} hover:shadow-md transition-all cursor-pointer h-full`}>
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between gap-1">
                            <BookOpen className="h-5 w-5 text-muted-foreground/60 shrink-0 mt-0.5" />
                            {subject.isElective && (
                              <Badge variant="outline" className="text-[9px] shrink-0">Elective</Badge>
                            )}
                          </div>
                          <h3 className="text-sm font-semibold mt-2 leading-tight">{subject.name}</h3>
                          <p className="text-[10px] text-muted-foreground mt-1">{subject.code}</p>
                        </CardContent>
                      </Card>
                    </Link>
                  );
                })}
              </div>
            </div>
          )}

          {/* Empty state when no board selected */}
          {!boardId && (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
                <Sparkles className="h-10 w-10 text-primary/50" />
                <div>
                  <p className="font-medium text-foreground">Get started with Padvik</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Select your education board and class to see your syllabus, notes, and more.
                  </p>
                </div>
                <Button onClick={() => setPickerOpen(true)}>
                  Choose Board & Class
                </Button>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Admin-specific section */}
      {userRole === "admin" && <AdminSection />}

      {/* Parent-specific section */}
      {userRole === "parent" && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">Your Child&apos;s Progress</h2>
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
              <BarChart3 className="h-10 w-10 text-primary/50" />
              <div>
                <p className="font-medium text-foreground">Progress tracking coming soon</p>
                <p className="text-sm text-muted-foreground mt-1">
                  You&apos;ll be able to view your child&apos;s learning progress, exam scores, and study time.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Teacher-specific section */}
      {userRole === "teacher" || userRole === "creator" && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">Your Classrooms</h2>
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
              <Users className="h-10 w-10 text-primary/50" />
              <div>
                <p className="font-medium text-foreground">Classroom management</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Create classrooms, assign exams, and track student performance.
                </p>
              </div>
              <Button asChild>
                <Link href="/dashboard/classroom">Go to Classrooms</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      <BoardPicker open={pickerOpen} onOpenChange={setPickerOpen} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Content type icon for classroom feed
// ---------------------------------------------------------------------------

function ContentTypeIcon({ type }: { type: string }) {
  const cls = "h-3.5 w-3.5 shrink-0";
  switch (type) {
    case "video": return <Play className={`${cls} text-blue-500`} />;
    case "audio": return <Activity className={`${cls} text-green-500`} />;
    case "image": return <Sparkles className={`${cls} text-amber-500`} />;
    case "document": return <FileText className={`${cls} text-red-500`} />;
    default: return <BookOpen className={`${cls} text-violet-500`} />;
  }
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  return `${Math.floor(days / 7)}w`;
}

// ---------------------------------------------------------------------------
// Admin Section with live pipeline stats
// ---------------------------------------------------------------------------

interface PipelineStats {
  totals: { contentItems: number; publishedItems: number; questions: number };
  aiUsageToday: Array<{ total_cost: number }>;
}

function SchoolsCard() {
  const [schoolCount, setSchoolCount] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/schools/stats")
      .then(r => r.json())
      .then(d => { if (d.success) setSchoolCount(d.data.totalSchools); })
      .catch(() => {});
  }, []);

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <h3 className="font-medium text-sm">Schools Directory</h3>
          {schoolCount !== null && (
            <Badge variant="secondary" className="text-xs">{schoolCount.toLocaleString()} schools</Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Browse, search, and import schools from CBSE, ICSE, Kerala SCERT, and UDISE databases.
        </p>
        <div className="flex gap-2 mt-3">
          <Button asChild variant="outline" size="sm">
            <Link href="/schools">Browse</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/schools">Import</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function AdminSection() {
  const [stats, setStats] = useState<PipelineStats | null>(null);

  useEffect(() => {
    fetch("/api/admin/pipeline-stats")
      .then((r) => r.json())
      .then((json) => { if (json.success) setStats(json.data); })
      .catch(() => {});
  }, []);

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold text-foreground">Administration</h2>

      {/* Stats row */}
      {stats && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MiniStat icon={<FileText className="h-4 w-4 text-violet-600" />} label="Content Items" value={stats.totals.contentItems} sub={`${stats.totals.publishedItems} published`} />
          <MiniStat icon={<HelpCircle className="h-4 w-4 text-blue-600" />} label="Questions" value={stats.totals.questions} sub="all types" />
          <MiniStat icon={<Database className="h-4 w-4 text-emerald-600" />} label="AI Cost Today" value={`$${stats.aiUsageToday.reduce((s, r) => s + Number(r.total_cost), 0).toFixed(2)}`} sub="last 24h" />
          <MiniStat icon={<Activity className="h-4 w-4 text-amber-600" />} label="Published" value={stats.totals.publishedItems} sub="live content" />
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <h3 className="font-medium text-sm">Content Pipeline</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Manage scraping jobs, DIKSHA ingestion, NCERT downloads, and AI content generation.
            </p>
            <div className="flex gap-2 mt-3">
              <Button asChild variant="outline" size="sm">
                <Link href="/admin/pipeline">Overview</Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href="/scrape-jobs">Manage Jobs</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <h3 className="font-medium text-sm">Content Review</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Review and approve pending AI-generated and scraped content.
            </p>
            <Button asChild variant="outline" size="sm" className="mt-3">
              <Link href="/admin/content-review">Review Queue</Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-violet-600" />
              <h3 className="font-medium text-sm">Auto-Content</h3>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              AI generates study material for high-demand topics. Review, approve & track cost.
            </p>
            <div className="flex gap-2 mt-3">
              <Button asChild variant="outline" size="sm">
                <Link href="/auto-content">Open Dashboard</Link>
              </Button>
              <Button asChild variant="ghost" size="sm">
                <Link href="/help/auto-content">Guide</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
        <SchoolsCard />
      </div>
    </div>
  );
}

function MiniStat({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string | number; sub: string }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted">{icon}</div>
        <div>
          <p className="text-lg font-bold tabular-nums">{value}</p>
          <p className="text-[10px] text-muted-foreground">{label} · {sub}</p>
        </div>
      </CardContent>
    </Card>
  );
}
