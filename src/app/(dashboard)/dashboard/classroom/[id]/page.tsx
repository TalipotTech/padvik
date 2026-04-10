"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, ArrowLeft, Users, BookOpen, LogOut, FileText, FileVideo, FileAudio, Image as ImageIcon, Eye } from "lucide-react";
import { toast } from "sonner";

interface ClassroomDetail {
  id: number; name: string; description: string | null;
  joinCode: string; studentCount: number; maxStudents: number;
  isActive: boolean; academicYear: string | null; teacherId: number;
}

interface ContentItem {
  id: number; title: string; contentType: string; description: string | null;
  thumbnailUrl: string | null; mediaUrl: string | null; viewCount: number;
  aiSummary: string | null; createdAt: string;
}

function ContentIcon({ type, className }: { type: string; className?: string }) {
  const cls = className || "h-5 w-5";
  switch (type) {
    case "video": return <FileVideo className={`${cls} text-blue-500`} />;
    case "audio": return <FileAudio className={`${cls} text-green-500`} />;
    case "image": return <ImageIcon className={`${cls} text-amber-500`} />;
    default: return <FileText className={`${cls} text-violet-500`} />;
  }
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
    const res = await fetch(`/api/classrooms/${params.id}/leave`, { method: "POST" });
    const data = await res.json();
    setLeaving(false);
    if (data.success) {
      toast.success("Left the classroom");
      router.push("/dashboard/classroom");
    } else {
      toast.error(data.error?.message || "Failed to leave");
    }
  }

  function trackView(contentId: number) {
    fetch(`/api/content/${contentId}/view`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ classroomId: Number(params.id) }),
    }).catch(() => {});
  }

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
  if (!classroom) return <p className="text-center py-10 text-muted-foreground">Classroom not found.</p>;

  return (
    <div className="space-y-6">
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
          {leaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogOut className="h-3.5 w-3.5" />}
          Leave
        </Button>
      </div>

      {classroom.description && <p className="text-sm text-muted-foreground">{classroom.description}</p>}

      {/* Content Feed from Creator */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <BookOpen className="h-5 w-5 text-primary" />
          Classroom Content ({content.length})
        </h2>
        {content.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              <FileText className="h-10 w-10 mx-auto mb-3" />
              <p>No content assigned yet.</p>
              <p className="text-xs mt-1">Your teacher will add lessons, notes, and materials here.</p>
            </CardContent>
          </Card>
        ) : (
          content.map(item => (
            <Link key={item.id} href={`/dashboard/content/${item.id}?classroom=${params.id}`} onClick={() => trackView(item.id)}>
              <Card className="hover:border-primary/30 transition-colors cursor-pointer">
                <CardContent className="flex items-center gap-4 py-4">
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-muted/50 border overflow-hidden">
                    {item.thumbnailUrl ? (
                      <img src={item.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <ContentIcon type={item.contentType} className="h-6 w-6" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium">{item.title}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <Badge variant="outline" className="text-[10px] capitalize py-0 h-5">{item.contentType}</Badge>
                      <span className="text-[10px] text-muted-foreground"><Eye className="h-3 w-3 inline mr-0.5" />{item.viewCount || 0} views</span>
                      <span className="text-[10px] text-muted-foreground">{new Date(item.createdAt).toLocaleDateString()}</span>
                    </div>
                    {item.description && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{item.description}</p>}
                    {item.aiSummary && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1 italic">{item.aiSummary}</p>}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
