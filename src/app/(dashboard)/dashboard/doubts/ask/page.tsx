"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, Send, Sparkles, HelpCircle } from "lucide-react";
import { toast } from "sonner";

interface MyClassroom {
  id: number; name: string; teacherName: string;
}

export default function AskDoubtPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [classrooms, setClassrooms] = useState<MyClassroom[]>([]);

  // Pre-fill from URL params (when asking from classroom or content page)
  const [form, setForm] = useState({
    questionText: "",
    classroomId: searchParams.get("classroom") || "",
    creatorId: searchParams.get("creator") || "",
    contentId: searchParams.get("content") || "",
  });

  // Fetch student's classrooms for the dropdown
  useEffect(() => {
    fetch("/api/my/classrooms")
      .then(r => r.json())
      .then(res => { if (res.success) setClassrooms(res.data || []); })
      .catch(() => {});
  }, []);

  // Auto-fill creator when classroom is selected
  useEffect(() => {
    if (form.classroomId) {
      const selected = classrooms.find(c => String(c.id) === form.classroomId);
      // Creator will be set from classroom context on the server side
    }
  }, [form.classroomId, classrooms]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.questionText.trim() || form.questionText.length < 10) {
      toast.error("Please describe your doubt in at least 10 characters");
      return;
    }

    setLoading(true);
    const res = await fetch("/api/doubts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        questionText: form.questionText,
        classroomId: form.classroomId ? Number(form.classroomId) : undefined,
        creatorId: form.creatorId ? Number(form.creatorId) : undefined,
        contentId: form.contentId ? Number(form.contentId) : undefined,
      }),
    });

    const data = await res.json();
    setLoading(false);

    if (data.success) {
      toast.success("Doubt posted! AI is generating a response...");
      router.push(`/dashboard/doubts/${data.data.id}`);
    } else {
      toast.error(data.error?.message || "Failed to post doubt");
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <HelpCircle className="h-6 w-6 text-primary" />
          Ask a Doubt
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Ask your question and get an instant AI answer + response from your teacher.
        </p>
      </div>

      {/* AI info */}
      <div className="flex items-start gap-3 rounded-lg border border-violet-200 bg-violet-50 dark:bg-violet-950/20 dark:border-violet-800 p-3">
        <Sparkles className="h-4 w-4 text-violet-600 shrink-0 mt-0.5" />
        <p className="text-xs text-violet-700 dark:text-violet-300">
          Your doubt will get an <strong>instant AI-generated answer</strong> while your teacher reviews it. The AI response is a draft — your teacher may edit or provide a better answer.
        </p>
      </div>

      <form onSubmit={handleSubmit}>
        <Card>
          <CardContent className="pt-6 space-y-4">
            {/* Question */}
            <div className="space-y-2">
              <Label htmlFor="questionText">Your Question *</Label>
              <textarea
                id="questionText"
                className="flex min-h-[150px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={form.questionText}
                onChange={(e) => setForm({ ...form, questionText: e.target.value })}
                placeholder="Type your doubt here... Be specific about what you don't understand. Include the topic, chapter, or problem number if possible."
                required
                minLength={10}
              />
              <p className="text-xs text-muted-foreground">{form.questionText.length} / 5000 characters</p>
            </div>

            {/* Classroom selector */}
            {classrooms.length > 0 && (
              <div className="space-y-2">
                <Label>Ask in Classroom (optional)</Label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={form.classroomId}
                  onChange={(e) => setForm({ ...form, classroomId: e.target.value })}
                >
                  <option value="">General doubt (no classroom)</option>
                  {classrooms.map(c => (
                    <option key={c.id} value={c.id}>{c.name} — {c.teacherName}</option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  Selecting a classroom sends the doubt to that teacher&apos;s inbox.
                </p>
              </div>
            )}

            <Button type="submit" className="w-full gap-2" disabled={loading || form.questionText.length < 10}>
              {loading ? (
                <><Loader2 className="h-4 w-4 animate-spin" />Posting &amp; generating AI answer...</>
              ) : (
                <><Send className="h-4 w-4" />Post Doubt</>
              )}
            </Button>
          </CardContent>
        </Card>
      </form>
    </div>
  );
}
