"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Users, Plus, Copy, Loader2, BookOpen } from "lucide-react";
import { toast } from "sonner";

interface Classroom {
  id: number; name: string; joinCode: string; studentCount: number;
  maxStudents: number; isActive: boolean; academicYear: string | null;
  description: string | null; boardName: string | null; standardGrade: number | null;
  subjectName: string | null; createdAt: string;
}

export default function CreatorClassroomsPage() {
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ name: "", description: "" });

  useEffect(() => { fetchClassrooms(); }, []);

  async function fetchClassrooms() {
    const res = await fetch("/api/classrooms?role=teacher");
    const data = await res.json();
    if (data.success) setClassrooms(data.data);
    setLoading(false);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    const res = await fetch("/api/classrooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    setCreating(false);
    if (data.success) {
      toast.success(`Classroom created! Invite code: ${data.data.joinCode}`);
      setDialogOpen(false);
      setForm({ name: "", description: "" });
      fetchClassrooms();
    } else {
      toast.error(data.error?.message || "Failed to create");
    }
  }

  function copyCode(code: string) {
    navigator.clipboard.writeText(code);
    toast.success("Invite code copied!");
  }

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">My Classrooms</h1>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2"><Plus className="h-4 w-4" />Create Classroom</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Create Classroom</DialogTitle></DialogHeader>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="space-y-2"><Label>Name *</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Class 10 Science Batch A" required minLength={2} /></div>
              <div className="space-y-2"><Label>Description</Label><Input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Optional description" /></div>
              <Button type="submit" className="w-full" disabled={creating}>
                {creating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}Create
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {classrooms.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">
          <Users className="h-10 w-10 mx-auto mb-3" />
          <p>No classrooms yet. Create one to invite students!</p>
        </CardContent></Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {classrooms.map(c => (
            <Link key={c.id} href={`/dashboard/creator/classrooms/${c.id}`}>
              <Card className="hover:border-primary/30 transition-colors cursor-pointer h-full">
                <CardContent className="py-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="font-medium">{c.name}</h3>
                    <Badge variant={c.isActive ? "default" : "secondary"}>{c.isActive ? "Active" : "Archived"}</Badge>
                  </div>
                  {(c.boardName || c.subjectName) && (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <BookOpen className="h-3 w-3" />
                      {[c.boardName, c.standardGrade ? `Class ${c.standardGrade}` : null, c.subjectName].filter(Boolean).join(" · ")}
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground"><Users className="h-3.5 w-3.5 inline mr-1" />{c.studentCount}/{c.maxStudents} students</span>
                    <Button variant="outline" size="sm" className="gap-1 text-xs h-7" onClick={(e) => { e.preventDefault(); copyCode(c.joinCode); }}>
                      <Copy className="h-3 w-3" />{c.joinCode}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
