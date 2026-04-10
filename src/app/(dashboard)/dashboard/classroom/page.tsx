"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Users, BookOpen, Loader2, LogIn, Mail, CheckCircle, X } from "lucide-react";
import { toast } from "sonner";

interface Classroom {
  id: number; name: string; description: string | null; studentCount: number;
  teacherName: string; teacherAvatar: string | null;
  boardName: string | null; standardGrade: number | null; subjectName: string | null;
  joinedAt: string;
}

interface PendingInvite {
  id: number; inviteToken: string; recipientName: string | null;
  channel: string; status: string; createdAt: string;
  classroomId: number; classroomName: string;
  creatorName: string; creatorAvatar: string | null;
}

export default function StudentClassroomPage() {
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [joinCode, setJoinCode] = useState("");
  const [joining, setJoining] = useState(false);
  const [acceptingToken, setAcceptingToken] = useState<string | null>(null);

  useEffect(() => { fetchAll(); }, []);

  async function fetchAll() {
    const [crRes, invRes] = await Promise.all([
      fetch("/api/my/classrooms").then(r => r.json()),
      fetch("/api/my/invites").then(r => r.json()),
    ]);
    if (crRes.success) setClassrooms(crRes.data);
    if (invRes.success) setInvites(invRes.data);
    setLoading(false);
  }

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    if (!joinCode.trim()) return;
    setJoining(true);
    const res = await fetch("/api/classrooms/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ joinCode: joinCode.trim() }),
    });
    const data = await res.json();
    setJoining(false);
    if (data.success) {
      toast.success(`Joined "${data.data.name}"!`);
      setJoinCode("");
      fetchAll();
    } else {
      toast.error(data.error?.message || "Failed to join");
    }
  }

  async function acceptInvite(token: string) {
    setAcceptingToken(token);
    const res = await fetch(`/api/classrooms/invite/${token}/accept`, { method: "POST" });
    const data = await res.json();
    setAcceptingToken(null);
    if (data.success) {
      toast.success(`Joined "${data.data.name}"!`);
      fetchAll();
    } else {
      toast.error(data.error?.message || "Failed to accept invite");
    }
  }

  async function dismissInvite(id: number) {
    // Just remove from local state — invite stays in DB for creator tracking
    setInvites(inv => inv.filter(i => i.id !== id));
  }

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">My Classrooms</h1>

      {/* Pending Invites */}
      {invites.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Mail className="h-4 w-4 text-violet-500" />
            Pending Invitations ({invites.length})
          </h2>
          {invites.map(inv => (
            <Card key={inv.id} className="border-violet-200 dark:border-violet-800 bg-violet-50/50 dark:bg-violet-950/10">
              <CardContent className="flex items-center gap-4 py-4">
                <Avatar className="h-10 w-10 shrink-0">
                  <AvatarImage src={inv.creatorAvatar || undefined} />
                  <AvatarFallback>{inv.creatorName?.[0] || "T"}</AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">
                    <span className="text-violet-700 dark:text-violet-300">{inv.creatorName}</span> invited you to join
                  </p>
                  <p className="text-base font-semibold">{inv.classroomName}</p>
                  <p className="text-xs text-muted-foreground">
                    {inv.recipientName ? `Hi ${inv.recipientName}! · ` : ""}
                    Sent {new Date(inv.createdAt).toLocaleDateString()} via {inv.channel}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    size="sm"
                    className="gap-1.5"
                    disabled={acceptingToken === inv.inviteToken}
                    onClick={() => acceptInvite(inv.inviteToken)}
                  >
                    {acceptingToken === inv.inviteToken ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <CheckCircle className="h-3.5 w-3.5" />
                    )}
                    Join
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => dismissInvite(inv.id)}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Join by code */}
      <Card>
        <CardContent className="py-4">
          <form onSubmit={handleJoin} className="flex gap-3 items-end">
            <div className="flex-1 space-y-1">
              <label className="text-sm font-medium">Join a Classroom</label>
              <Input value={joinCode} onChange={e => setJoinCode(e.target.value)} placeholder="Enter invite code (e.g. BRIL3A)" />
            </div>
            <Button type="submit" disabled={joining} className="gap-1.5">
              {joining ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
              Join
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Enrolled classrooms */}
      {classrooms.length === 0 && invites.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">
          <Users className="h-10 w-10 mx-auto mb-3" />
          <p>You haven&apos;t joined any classrooms yet.</p>
          <p className="text-xs mt-1">Ask your teacher for an invite code to join.</p>
        </CardContent></Card>
      ) : classrooms.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold">Enrolled Classrooms ({classrooms.length})</h2>
          {classrooms.map(c => (
            <Link key={c.id} href={`/dashboard/classroom/${c.id}`}>
              <Card className="hover:border-primary/30 transition-colors cursor-pointer">
                <CardContent className="flex items-center gap-4 py-4">
                  <Avatar className="h-10 w-10 shrink-0">
                    <AvatarImage src={c.teacherAvatar || undefined} />
                    <AvatarFallback>{c.teacherName?.[0] || "T"}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium">{c.name}</p>
                    <p className="text-xs text-muted-foreground">by {c.teacherName}</p>
                    {(c.boardName || c.subjectName) && (
                      <div className="flex items-center gap-1 mt-0.5 text-xs text-muted-foreground">
                        <BookOpen className="h-3 w-3" />
                        {[c.boardName, c.standardGrade ? `Class ${c.standardGrade}` : null, c.subjectName].filter(Boolean).join(" · ")}
                      </div>
                    )}
                  </div>
                  <Badge variant="secondary" className="text-xs"><Users className="h-3 w-3 mr-1 inline" />{c.studentCount}</Badge>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
