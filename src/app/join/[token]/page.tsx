"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { PadvikLogo } from "@/components/ui/padvik-logo";
import { Loader2, Users, BookOpen, CheckCircle, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";

interface InviteData {
  invite: { token: string; recipientName: string | null; status: string };
  classroom: {
    id: number; name: string; description: string | null;
    joinCode: string; studentCount: number; maxStudents: number;
    teacherName: string; teacherAvatar: string | null;
    boardName: string | null; standardGrade: number | null; subjectName: string | null;
  };
}

export default function JoinInvitePage() {
  const params = useParams();
  const router = useRouter();
  const [data, setData] = useState<InviteData | null>(null);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joined, setJoined] = useState(false);

  useEffect(() => {
    fetch(`/api/classrooms/invite/${params.token}`)
      .then(r => r.json())
      .then(res => {
        if (res.success) setData(res.data);
        else setError(res.error?.message || "Invalid invite");
      })
      .catch(() => setError("Failed to load invite"))
      .finally(() => setLoading(false));
  }, [params.token]);

  async function handleJoin() {
    setJoining(true);
    const res = await fetch(`/api/classrooms/invite/${params.token}/accept`, { method: "POST" });
    const result = await res.json();
    setJoining(false);

    if (result.success) {
      setJoined(true);
      toast.success(`Joined "${result.data.name}"!`);
    } else if (result.error?.code === "UNAUTHORIZED") {
      // Not logged in — redirect to login then back here
      router.push(`/login?callbackUrl=/join/${params.token}`);
    } else {
      toast.error(result.error?.message || "Failed to join");
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="max-w-md w-full">
          <CardContent className="py-12 text-center space-y-4">
            <AlertCircle className="h-12 w-12 text-destructive mx-auto" />
            <h2 className="text-xl font-bold">Invite Not Available</h2>
            <p className="text-muted-foreground">{error}</p>
            <Link href="/dashboard/classroom">
              <Button variant="outline">Go to Classrooms</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!data) return null;
  const { classroom, invite } = data;
  const curriculum = [classroom.boardName, classroom.standardGrade ? `Class ${classroom.standardGrade}` : null, classroom.subjectName].filter(Boolean).join(" · ");

  if (joined) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="max-w-md w-full">
          <CardContent className="py-12 text-center space-y-4">
            <CheckCircle className="h-16 w-16 text-green-500 mx-auto" />
            <h2 className="text-2xl font-bold">You&apos;re in!</h2>
            <p className="text-muted-foreground">You&apos;ve joined <strong>{classroom.name}</strong></p>
            <Link href="/dashboard/classroom">
              <Button>Go to My Classrooms</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-violet-50 to-indigo-50 dark:from-violet-950/20 dark:to-indigo-950/20 flex items-center justify-center p-4">
      <Card className="max-w-md w-full shadow-xl">
        <CardContent className="py-8 space-y-6">
          {/* Logo */}
          <div className="text-center">
            <PadvikLogo size="lg" />
          </div>

          {/* Invite header */}
          <div className="text-center space-y-1">
            <p className="text-sm text-muted-foreground">
              {invite.recipientName ? `${invite.recipientName}, you're` : "You're"} invited to join
            </p>
            <h1 className="text-2xl font-bold text-primary">{classroom.name}</h1>
          </div>

          {/* Teacher info */}
          <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
            <Avatar className="h-10 w-10">
              <AvatarImage src={classroom.teacherAvatar || undefined} />
              <AvatarFallback>{classroom.teacherName?.[0] || "T"}</AvatarFallback>
            </Avatar>
            <div>
              <p className="text-sm font-medium">{classroom.teacherName}</p>
              <p className="text-xs text-muted-foreground">Teacher</p>
            </div>
          </div>

          {/* Classroom details */}
          <div className="space-y-2">
            {curriculum && (
              <div className="flex items-center gap-2 text-sm">
                <BookOpen className="h-4 w-4 text-violet-500" />
                <span>{curriculum}</span>
              </div>
            )}
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Users className="h-4 w-4" />
              <span>{classroom.studentCount} students enrolled</span>
            </div>
            {classroom.description && (
              <p className="text-sm text-muted-foreground">{classroom.description}</p>
            )}
          </div>

          {/* Join button */}
          <Button className="w-full gap-2" size="lg" onClick={handleJoin} disabled={joining}>
            {joining ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />}
            {joining ? "Joining..." : "Join Classroom"}
          </Button>

          <p className="text-xs text-center text-muted-foreground">
            Or enter code <strong className="text-primary">{classroom.joinCode}</strong> on{" "}
            <Link href="/dashboard/classroom" className="text-primary hover:underline">Padvik</Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
