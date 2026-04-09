"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";

export default function AskDoubtPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    questionText: "",
    topicId: "",
    creatorId: "",
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    const res = await fetch("/api/doubts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        questionText: form.questionText,
        topicId: form.topicId ? Number(form.topicId) : undefined,
        creatorId: form.creatorId ? Number(form.creatorId) : undefined,
      }),
    });

    const data = await res.json();
    setLoading(false);

    if (data.success) {
      toast.success("Doubt posted!");
      router.push(`/dashboard/doubts/${data.data.id}`);
    } else {
      toast.error(data.error?.message || "Failed to post doubt");
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">Ask a Doubt</h1>

      <form onSubmit={handleSubmit}>
        <Card>
          <CardHeader>
            <CardTitle>Your Question</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="questionText">Describe your doubt *</Label>
              <textarea
                id="questionText"
                className="flex min-h-[150px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={form.questionText}
                onChange={(e) => setForm({ ...form, questionText: e.target.value })}
                placeholder="Explain your doubt in detail. Include what you've already tried..."
                required
                minLength={10}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="topicId">Topic ID (optional)</Label>
                <Input
                  id="topicId"
                  type="number"
                  value={form.topicId}
                  onChange={(e) => setForm({ ...form, topicId: e.target.value })}
                  placeholder="Related topic"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="creatorId">Ask a specific creator (optional)</Label>
                <Input
                  id="creatorId"
                  type="number"
                  value={form.creatorId}
                  onChange={(e) => setForm({ ...form, creatorId: e.target.value })}
                  placeholder="Creator user ID"
                />
              </div>
            </div>

            <Button type="submit" className="w-full gap-2" disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Post Doubt
            </Button>
          </CardContent>
        </Card>
      </form>
    </div>
  );
}
