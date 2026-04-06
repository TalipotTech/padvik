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
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BoardPicker } from "@/components/layout/board-picker";
import { Skeleton } from "@/components/ui/skeleton";
import { useBoardSelection } from "@/hooks/use-board-selection";
import { useData } from "@/hooks/use-data";
import { getSubjects } from "@/lib/data";

interface DashboardHomeProps {
  userName: string;
  userRole: string;
}

const studentActions = [
  { href: "/dashboard/syllabus", label: "Browse Syllabus", icon: BookOpen, color: "text-primary" },
  { href: "/dashboard/question-bank", label: "Question Bank", icon: ClipboardList, color: "text-violet-600" },
  { href: "/dashboard/exams", label: "Take an Exam", icon: FileText, color: "text-orange-600" },
  { href: "/dashboard/chat", label: "Ask AI", icon: MessageSquare, color: "text-blue-600" },
];

const teacherActions = [
  { href: "/dashboard/classroom", label: "My Classrooms", icon: Users, color: "text-primary" },
  { href: "/dashboard/question-bank", label: "Question Bank", icon: ClipboardList, color: "text-violet-600" },
  { href: "/dashboard/exams", label: "Create Exam", icon: FileText, color: "text-orange-600" },
  { href: "/dashboard/analytics", label: "Class Analytics", icon: BarChart3, color: "text-blue-600" },
];

const adminActions = [
  { href: "/scrape-jobs", label: "Scrape Pipeline", icon: Upload, color: "text-primary" },
  { href: "/curriculum", label: "Curriculum Explorer", icon: Layers, color: "text-violet-600" },
  { href: "/question-papers", label: "Question Papers", icon: ClipboardList, color: "text-orange-600" },
  { href: "/dashboard/syllabus", label: "Browse Syllabus", icon: BookOpen, color: "text-blue-600" },
  { href: "/dashboard/analytics", label: "Analytics", icon: BarChart3, color: "text-emerald-600" },
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
    case "teacher": return teacherActions;
    case "admin": return adminActions;
    case "parent": return parentActions;
    default: return studentActions;
  }
}

function getRoleLabel(role: string) {
  switch (role) {
    case "teacher": return "Teacher";
    case "admin": return "Administrator";
    case "parent": return "Parent";
    default: return "Student";
  }
}

export function DashboardHome({ userName, userRole }: DashboardHomeProps) {
  const { boardId, boardName, grade } = useBoardSelection();
  const [pickerOpen, setPickerOpen] = useState(false);

  // Auto-open picker if no board selected (students and teachers need board context)
  useEffect(() => {
    if (!boardId && (userRole === "student" || userRole === "teacher")) {
      setPickerOpen(true);
    }
  }, [boardId, userRole]);

  const firstName = userName.split(" ")[0].split("@")[0];
  const quickActions = getActionsForRole(userRole);

  const { data: subjects, loading: subjectsLoading } = useData(
    () => boardId && grade ? getSubjects(boardId, grade) : Promise.resolve([]),
    [boardId, grade],
  );

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
          {(userRole === "student" || userRole === "teacher") && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPickerOpen(true)}
              className="shrink-0"
            >
              {boardName ? "Change" : "Select Board"}
            </Button>
          )}
        </div>
      </div>

      {/* Quick actions — role-specific */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {quickActions.map((action) => (
          <Link key={action.href} href={action.href}>
            <Card className="hover:border-primary/50 transition-colors cursor-pointer h-full">
              <CardContent className="flex flex-col items-center gap-2 p-4 text-center">
                <action.icon className={`h-6 w-6 ${action.color}`} />
                <span className="text-sm font-medium">{action.label}</span>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {/* Subjects overview — for students and teachers */}
      {(userRole === "student" || userRole === "teacher") && (
        <>
          {subjectsLoading && boardId && (
            <div className="space-y-3">
              <h2 className="text-lg font-semibold text-foreground">
                {userRole === "teacher" ? "Subjects" : "Your Subjects"}
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
                {userRole === "teacher" ? "Subjects" : "Your Subjects"}
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {(subjects ?? []).map((subject) => (
                  <Link
                    key={subject.id}
                    href={`/dashboard/syllabus?subjectId=${subject.id}`}
                  >
                    <Card className="hover:border-primary/50 transition-colors cursor-pointer h-full">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base">{subject.name}</CardTitle>
                      </CardHeader>
                      <CardContent className="pt-0">
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary" className="text-xs">
                            {subject.code}
                          </Badge>
                          {subject.isElective && (
                            <Badge variant="outline" className="text-xs">
                              Elective
                            </Badge>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                ))}
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
      {userRole === "admin" && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">Administration</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Card>
              <CardContent className="p-4">
                <h3 className="font-medium text-sm">Content Pipeline</h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Manage scraping jobs, review content, and monitor the pipeline.
                </p>
                <Button asChild variant="outline" size="sm" className="mt-3">
                  <Link href="/scrape-jobs">Manage Jobs</Link>
                </Button>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <h3 className="font-medium text-sm">Content Review</h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Review and approve pending AI-generated and user-uploaded content.
                </p>
                <Badge variant="outline" className="mt-3 text-xs">Coming soon</Badge>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

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
      {userRole === "teacher" && (
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
