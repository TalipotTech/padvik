"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { BookOpen, FileText, GraduationCap, MessageSquare, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BoardPicker } from "@/components/layout/board-picker";
import { useBoardSelection } from "@/hooks/use-board-selection";
import { getMockSubjects, getMockStandards } from "@/lib/mock-data";

interface DashboardHomeProps {
  userName: string;
}

const quickActions = [
  { href: "/dashboard/syllabus", label: "Browse Syllabus", icon: BookOpen, color: "text-primary" },
  { href: "/dashboard/learn", label: "Continue Learning", icon: GraduationCap, color: "text-emerald-600" },
  { href: "/dashboard/exams", label: "Take an Exam", icon: FileText, color: "text-orange-600" },
  { href: "/dashboard/chat", label: "Ask AI", icon: MessageSquare, color: "text-blue-600" },
];

export function DashboardHome({ userName }: DashboardHomeProps) {
  const { boardId, boardName, grade, setSelection } = useBoardSelection();
  const [pickerOpen, setPickerOpen] = useState(false);

  // Auto-open picker if no board selected
  useEffect(() => {
    if (!boardId) {
      setPickerOpen(true);
    }
  }, [boardId]);

  const firstName = userName.split(" ")[0].split("@")[0];
  const subjects = boardId && grade ? getMockSubjects(boardId, grade) : [];

  return (
    <div className="space-y-6 pt-2">
      {/* Welcome banner */}
      <div className="rounded-xl bg-gradient-to-r from-primary/10 via-primary/5 to-transparent border p-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground sm:text-3xl">
              Welcome back, {firstName}!
            </h1>
            <p className="mt-1 text-muted-foreground">
              {boardName && grade
                ? `${boardName} · Class ${grade}`
                : "Select your board and class to get started"}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPickerOpen(true)}
            className="shrink-0"
          >
            {boardName ? "Change" : "Select Board"}
          </Button>
        </div>
      </div>

      {/* Quick actions */}
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

      {/* Subjects overview */}
      {subjects.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">Your Subjects</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {subjects.map((subject) => (
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

      <BoardPicker open={pickerOpen} onOpenChange={setPickerOpen} />
    </div>
  );
}
