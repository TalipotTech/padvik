"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Copy, Users, Trash2, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";

interface Member {
  id: number; studentId: number; studentName: string; studentEmail: string | null;
  studentAvatar: string | null; role: string; joinedAt: string;
}

export default function ClassroomDetailPage() {
  const params = useParams();
  const [classroom, setClassroom] = useState<Record<string, unknown> | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch(`/api/classrooms/${params.id}`).then(r => r.json()),
      fetch(`/api/classrooms/${params.id}/members`).then(r => r.json()),
    ]).then(([cr, mr]) => {
      if (cr.success) setClassroom(cr.data);
      if (mr.success) setMembers(mr.data);
    }).finally(() => setLoading(false));
  }, [params.id]);

  async function removeMember(memberId: number) {
    if (!confirm("Remove this student?")) return;
    const res = await fetch(`/api/classrooms/${params.id}/members/${memberId}`, { method: "DELETE" });
    const data = await res.json();
    if (data.success) { toast.success("Student removed"); setMembers(m => m.filter(x => x.id !== memberId)); }
  }

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
  if (!classroom) return <p className="text-center py-10 text-muted-foreground">Classroom not found.</p>;

  const joinCode = classroom.joinCode as string;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/dashboard/creator/classrooms"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">{classroom.name as string}</h1>
          <p className="text-sm text-muted-foreground">{members.length} students enrolled</p>
        </div>
        <Button variant="outline" className="gap-1.5" onClick={() => { navigator.clipboard.writeText(joinCode); toast.success("Copied!"); }}>
          <Copy className="h-4 w-4" />Invite: {joinCode}
        </Button>
      </div>

      <Tabs defaultValue="members">
        <TabsList>
          <TabsTrigger value="members" className="gap-1.5"><Users className="h-3.5 w-3.5" />Members ({members.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="members" className="mt-4 space-y-2">
          {members.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground">No students yet. Share the invite code: <strong>{joinCode}</strong></CardContent></Card>
          ) : (
            members.map(m => (
              <Card key={m.id}>
                <CardContent className="flex items-center gap-3 py-3">
                  <Avatar className="h-9 w-9"><AvatarImage src={m.studentAvatar || undefined} /><AvatarFallback>{m.studentName?.[0] || "S"}</AvatarFallback></Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{m.studentName}</p>
                    <p className="text-xs text-muted-foreground">{m.studentEmail} · Joined {new Date(m.joinedAt).toLocaleDateString()}</p>
                  </div>
                  <Badge variant="outline" className="text-xs capitalize">{m.role}</Badge>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => removeMember(m.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
