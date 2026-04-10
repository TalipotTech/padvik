"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  Loader2, Copy, Users, Trash2, ArrowLeft, Send, Plus, X,
  Mail, Phone, MessageCircle, CheckCircle, Clock, AlertCircle,
  FileText, QrCode, BookOpen, Link2,
} from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";

interface Member {
  id: number; memberId?: number; studentId: number; studentName: string; studentEmail: string | null;
  studentAvatar: string | null; role: string; joinedAt: string;
  progress?: { totalViews: number; watchMinutes: number; completedContent: number; doubtsAsked: number };
}

interface Invite {
  id: number; recipientName: string | null; recipientEmail: string | null;
  recipientPhone: string | null; channel: string; status: string;
  sentAt: string | null; acceptedAt: string | null; createdAt: string;
}

interface Recipient {
  name: string;
  email: string;
  phone: string;
  channels: string[];
}

const STATUS_ICONS: Record<string, React.ReactNode> = {
  sent: <Clock className="h-3.5 w-3.5 text-blue-500" />,
  accepted: <CheckCircle className="h-3.5 w-3.5 text-green-500" />,
  failed: <AlertCircle className="h-3.5 w-3.5 text-red-500" />,
  pending: <Clock className="h-3.5 w-3.5 text-muted-foreground" />,
};

const CHANNEL_ICONS: Record<string, React.ReactNode> = {
  email: <Mail className="h-3.5 w-3.5" />,
  sms: <Phone className="h-3.5 w-3.5" />,
  whatsapp: <MessageCircle className="h-3.5 w-3.5" />,
};

export default function ClassroomDetailPage() {
  const params = useParams();
  const [classroom, setClassroom] = useState<Record<string, unknown> | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [contentItems, setContentItems] = useState<Array<{ id: number; title: string; contentType: string; viewCount: number; createdAt: string }>>([]);
  const [myContent, setMyContent] = useState<Array<{ id: number; title: string; contentType: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [assigningContent, setAssigningContent] = useState(false);

  useEffect(() => { fetchAll(); }, [params.id]);

  async function fetchAll() {
    const [cr, mr, ir, ct, mc] = await Promise.all([
      fetch(`/api/classrooms/${params.id}`).then(r => r.json()),
      fetch(`/api/classrooms/${params.id}/students`).then(r => r.json()).catch(() => fetch(`/api/classrooms/${params.id}/members`).then(r => r.json())),
      fetch(`/api/classrooms/${params.id}/invite`).then(r => r.json()),
      fetch(`/api/classrooms/${params.id}/content`).then(r => r.json()).catch(() => ({ success: false })),
      fetch(`/api/creators/content?limit=50`).then(r => r.json()).catch(() => ({ success: false })),
    ]);
    if (cr.success) setClassroom(cr.data);
    if (mr.success) setMembers(mr.data);
    if (ir.success) setInvites(ir.data);
    if (ct.success) setContentItems(ct.data || []);
    if (mc.success) setMyContent(mc.data?.items || []);
    setLoading(false);
  }

  async function assignContent(contentId: number) {
    setAssigningContent(true);
    const res = await fetch(`/api/classrooms/${params.id}/content`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contentId }),
    });
    const data = await res.json();
    setAssigningContent(false);
    if (data.success) {
      toast.success("Content assigned to classroom");
      fetchAll();
    } else toast.error(data.error?.message || "Failed to assign");
  }

  async function removeMember(memberId: number) {
    if (!confirm("Remove this student?")) return;
    const res = await fetch(`/api/classrooms/${params.id}/members/${memberId}`, { method: "DELETE" });
    if ((await res.json()).success) { toast.success("Student removed"); setMembers(m => m.filter(x => x.id !== memberId)); }
  }

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
  if (!classroom) return <p className="text-center py-10 text-muted-foreground">Classroom not found.</p>;

  const joinCode = classroom.joinCode as string;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/dashboard/creator/classrooms"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">{classroom.name as string}</h1>
          <p className="text-sm text-muted-foreground">{members.length} students enrolled</p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => { navigator.clipboard.writeText(joinCode); toast.success("Code copied!"); }}>
          <Copy className="h-4 w-4" />{joinCode}
        </Button>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => {
          const link = `${window.location.origin}/dashboard/classroom`;
          navigator.clipboard.writeText(`Join code: ${joinCode}\nLink: ${link}`);
          toast.success("Invite link copied!");
        }}>
          <Link2 className="h-4 w-4" />Share
        </Button>
        <InviteDialog classroomId={Number(params.id)} open={inviteOpen} onOpenChange={setInviteOpen} onSent={() => fetchAll()} />
      </div>

      <Tabs defaultValue="members">
        <TabsList>
          <TabsTrigger value="members" className="gap-1.5"><Users className="h-3.5 w-3.5" />Members ({members.length})</TabsTrigger>
          <TabsTrigger value="content" className="gap-1.5"><BookOpen className="h-3.5 w-3.5" />Content ({contentItems.length})</TabsTrigger>
          <TabsTrigger value="invites" className="gap-1.5"><Send className="h-3.5 w-3.5" />Invites ({invites.length})</TabsTrigger>
        </TabsList>

        {/* Members Tab */}
        <TabsContent value="members" className="mt-4 space-y-2">
          {members.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground">
              No students yet. Invite students using the button above.
            </CardContent></Card>
          ) : (
            members.map(m => (
              <Card key={m.id || m.memberId}>
                <CardContent className="flex items-center gap-3 py-3">
                  <Avatar className="h-9 w-9"><AvatarImage src={m.studentAvatar || undefined} /><AvatarFallback>{m.studentName?.[0] || "S"}</AvatarFallback></Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{m.studentName}</p>
                    <p className="text-xs text-muted-foreground">{m.studentEmail} · Joined {new Date(m.joinedAt).toLocaleDateString()}</p>
                    {m.progress && (
                      <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground">
                        <span>{m.progress.totalViews} views</span>
                        <span>{m.progress.watchMinutes} min watched</span>
                        <span>{m.progress.completedContent} completed</span>
                        <span>{m.progress.doubtsAsked} doubts</span>
                      </div>
                    )}
                  </div>
                  <Badge variant="outline" className="text-xs capitalize">{m.role}</Badge>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => removeMember(m.id || m.memberId!)}><Trash2 className="h-3.5 w-3.5" /></Button>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        {/* Content Tab */}
        <TabsContent value="content" className="mt-4 space-y-4">
          {/* Assign content */}
          {myContent.length > 0 && (
            <Card>
              <CardContent className="py-3">
                <div className="flex items-center gap-2">
                  <select
                    className="flex-1 h-9 rounded-md border bg-background px-3 text-sm"
                    defaultValue=""
                    onChange={e => { if (e.target.value) assignContent(Number(e.target.value)); e.target.value = ""; }}
                    disabled={assigningContent}
                  >
                    <option value="">Assign content to this classroom...</option>
                    {myContent.map(c => (
                      <option key={c.id} value={c.id}>{c.title} ({c.contentType})</option>
                    ))}
                  </select>
                </div>
              </CardContent>
            </Card>
          )}

          {contentItems.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground">
              <FileText className="h-8 w-8 mx-auto mb-2" />
              <p>No content assigned yet.</p>
              <p className="text-xs mt-1">Assign content from the dropdown above or upload new content first.</p>
            </CardContent></Card>
          ) : (
            contentItems.map(item => (
              <Card key={item.id}>
                <CardContent className="flex items-center gap-3 py-3">
                  <FileText className="h-5 w-5 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{item.title}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <Badge variant="outline" className="text-[10px] capitalize py-0 h-5">{item.contentType}</Badge>
                      <span className="text-[10px] text-muted-foreground">{item.viewCount || 0} views</span>
                      <span className="text-[10px] text-muted-foreground">{new Date(item.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        {/* Invites Tab */}
        <TabsContent value="invites" className="mt-4 space-y-2">
          {invites.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground">
              No invites sent yet.
            </CardContent></Card>
          ) : (
            invites.map(inv => (
              <Card key={inv.id}>
                <CardContent className="flex items-center gap-3 py-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted">
                    {CHANNEL_ICONS[inv.channel] || <Send className="h-4 w-4" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{inv.recipientName || "Unknown"}</p>
                    <p className="text-xs text-muted-foreground">
                      {inv.recipientEmail || inv.recipientPhone} · {inv.channel}
                      {inv.sentAt ? ` · Sent ${new Date(inv.sentAt).toLocaleDateString()}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {STATUS_ICONS[inv.status]}
                    <Badge variant={inv.status === "accepted" ? "default" : inv.status === "failed" ? "destructive" : "secondary"} className="text-xs capitalize">
                      {inv.status}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ── Invite Dialog ──
function InviteDialog({ classroomId, open, onOpenChange, onSent }: {
  classroomId: number; open: boolean; onOpenChange: (o: boolean) => void; onSent: () => void;
}) {
  const [recipients, setRecipients] = useState<Recipient[]>([{ name: "", email: "", phone: "", channels: ["email"] }]);
  const [sending, setSending] = useState(false);

  function addRecipient() {
    setRecipients(r => [...r, { name: "", email: "", phone: "", channels: ["email"] }]);
  }

  function removeRecipient(index: number) {
    setRecipients(r => r.filter((_, i) => i !== index));
  }

  function updateRecipient(index: number, field: keyof Recipient, value: string | string[]) {
    setRecipients(r => r.map((rec, i) => i === index ? { ...rec, [field]: value } : rec));
  }

  function toggleChannel(index: number, ch: string) {
    setRecipients(r => r.map((rec, i) => {
      if (i !== index) return rec;
      const channels = rec.channels.includes(ch) ? rec.channels.filter(c => c !== ch) : [...rec.channels, ch];
      return { ...rec, channels: channels.length > 0 ? channels : [ch] };
    }));
  }

  async function handleSend() {
    const valid = recipients.filter(r => r.name.trim() && r.channels.length > 0 && (r.email || r.phone));
    if (valid.length === 0) { toast.error("Add at least one recipient with name and contact info"); return; }

    setSending(true);
    const res = await fetch(`/api/classrooms/${classroomId}/invite`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipients: valid }),
    });
    const data = await res.json();
    setSending(false);

    if (data.success) {
      const { sent, failed } = data.data.summary;
      toast.success(`${sent} invite(s) sent${failed > 0 ? `, ${failed} failed` : ""}`);
      onOpenChange(false);
      setRecipients([{ name: "", email: "", phone: "", channels: ["email"] }]);
      onSent();
    } else {
      toast.error(data.error?.message || "Failed to send invites");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button className="gap-2"><Send className="h-4 w-4" />Invite Students</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Invite Students</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {recipients.map((rec, i) => (
            <div key={i} className="rounded-lg border p-3 space-y-3 relative">
              {recipients.length > 1 && (
                <button onClick={() => removeRecipient(i)} className="absolute top-2 right-2 text-muted-foreground hover:text-destructive">
                  <X className="h-4 w-4" />
                </button>
              )}
              <div className="space-y-1.5">
                <Label className="text-xs">Student Name *</Label>
                <Input value={rec.name} onChange={e => updateRecipient(i, "name", e.target.value)} placeholder="Student's name" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">Email</Label>
                  <Input type="email" value={rec.email} onChange={e => updateRecipient(i, "email", e.target.value)} placeholder="student@email.com" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Phone</Label>
                  <Input type="tel" value={rec.phone} onChange={e => updateRecipient(i, "phone", e.target.value)} placeholder="+91 98765 43210" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Send via</Label>
                <div className="flex gap-2">
                  {[
                    { id: "email", label: "Email", icon: <Mail className="h-3.5 w-3.5" />, needsEmail: true },
                    { id: "sms", label: "SMS", icon: <Phone className="h-3.5 w-3.5" />, needsPhone: true },
                    { id: "whatsapp", label: "WhatsApp", icon: <MessageCircle className="h-3.5 w-3.5" />, needsPhone: true },
                  ].map(ch => (
                    <Button
                      key={ch.id}
                      type="button"
                      variant={rec.channels.includes(ch.id) ? "default" : "outline"}
                      size="sm"
                      className="gap-1.5 text-xs flex-1"
                      onClick={() => toggleChannel(i, ch.id)}
                    >
                      {ch.icon}{ch.label}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          ))}

          <Button type="button" variant="outline" size="sm" className="w-full gap-1.5" onClick={addRecipient}>
            <Plus className="h-3.5 w-3.5" />Add Another Student
          </Button>

          <Button className="w-full gap-2" onClick={handleSend} disabled={sending}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {sending ? "Sending..." : `Send Invite${recipients.length > 1 ? "s" : ""}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
