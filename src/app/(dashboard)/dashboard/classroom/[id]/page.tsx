"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Loader2, ArrowLeft, Users, BookOpen, LogOut, FileText } from "lucide-react";
import { toast } from "sonner";

interface ClassroomDetail {
  id: number; name: string; description: string | null;
  joinCode: string; studentCount: number; maxStudents: number;
  isActive: boolean; academicYear: string | null;
  teacherId: number;
}

interface ContentItem {
  id: number; title: string; contentType: string; description: string | null;
  createdAt: string;
}

export default function StudentClassroomDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [classroom, setClassroom] = useState<ClassroomDetail | null>(null);
  const [content, setContent] = useState<ContentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch(`/api/classrooms/${params.id}`).then(r => r.json()),
      fetch(`/api/classrooms/${params.id}/content`).then(r => r.json()).catch(() => ({ success: false })),
    ]).then(([cr, ct]) => {
      if (cr.success) setClassroom(cr.data);
      if (ct.success) setContent(ct.data || []);
    }).finally(() => setLoading(false));
  }, [params.id]);

  async function handleLeave() {
    if (!confirm("Leave this classroom? You can rejoin later with the invite code.")) return;
    setLeaving(true);
    // Use the join API to leave — set status to 'left'
    // For now, just navigate back since we don't have a leave endpoint yet
    toast.info("Leave functionality coming soon. Contact your teacher.");
    setLeaving(false);
  }

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
  if (!classroom) return <p className="text-center py-10 text-muted-foreground">Classroom not found.</p>;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/dashboard/classroom"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">{classroom.name}</h1>
          <div className="flex items-center gap-2 mt-1">
            <Badge variant="secondary" className="text-xs"><Users className="h-3 w-3 mr-1 inline" />{classroom.studentCount} students</Badge>
            {classroom.academicYear && <Badge variant="outline" className="text-xs">{classroom.academicYear}</Badge>}
          </div>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5 text-destructive hover:text-destructive" onClick={handleLeave} disabled={leaving}>
          <LogOut className="h-3.5 w-3.5" />Leave
        </Button>
      </div>

      {/* Description */}
      {classroom.description && (
        <p className="text-sm text-muted-foreground">{classroom.description}</p>
      )}

      {/* Assigned Content */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Classroom Content</h2>
        {content.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              <FileText className="h-10 w-10 mx-auto mb-3" />
              <p>No content assigned to this classroom yet.</p>
              <p className="text-xs mt-1">Your teacher will assign lessons, notes, and materials here.</p>
            </CardContent>
          </Card>
        ) : (
          content.map(item => (
            <Card key={item.id} className="hover:border-primary/30 transition-colors cursor-pointer">
              <CardContent className="flex items-center gap-4 py-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  <FileText className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium">{item.title}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <Badge variant="outline" className="text-[10px] capitalize py-0 h-5">{item.contentType}</Badge>
                    <span className="text-xs text-muted-foreground">{new Date(item.createdAt).toLocaleDateString()}</span>
                  </div>
                  {item.description && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{item.description}</p>}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
