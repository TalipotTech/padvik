"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";

/** Map signup creatorType param → institutionType value */
const TYPE_MAP: Record<string, string> = {
  "school-teacher": "school",
  "coaching-instructor": "tuition",
  "independent-educator": "independent",
  "student-creator": "student",
  "content-publisher": "publisher",
};

export default function CreatorRegisterPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    displayName: "",
    bio: "",
    institution: "",
    institutionType: "",
  });

  // Auto-fill from URL search params (passed from creator signup dialog)
  useEffect(() => {
    const name = searchParams.get("name");
    const type = searchParams.get("type");

    if (name || type) {
      setForm((prev) => ({
        ...prev,
        displayName: name || prev.displayName,
        institutionType: type ? (TYPE_MAP[type] || "") : prev.institutionType,
      }));
    }
  }, [searchParams]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    const res = await fetch("/api/creators/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        displayName: form.displayName,
        bio: form.bio || undefined,
        institution: form.institution || undefined,
        institutionType: form.institutionType || undefined,
      }),
    });

    const data = await res.json();
    setLoading(false);

    if (data.success) {
      toast.success("Welcome! You are now a creator.");
      // Full page reload to force server-side session re-check from DB
      window.location.href = "/dashboard/creator";
    } else {
      toast.error(data.error?.message || "Registration failed");
    }
  }

  return (
    <div className="max-w-lg mx-auto py-10">
      <Card>
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
              <Sparkles className="h-8 w-8 text-primary" />
            </div>
          </div>
          <CardTitle className="text-2xl">Become a Creator</CardTitle>
          <CardDescription>
            Share your knowledge with students across India. Start publishing
            video lessons, notes, and question sets today.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="displayName">Display Name *</Label>
              <Input
                id="displayName"
                value={form.displayName}
                onChange={(e) => setForm({ ...form, displayName: e.target.value })}
                placeholder="How students will see your name"
                required
                minLength={2}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="bio">Bio</Label>
              <textarea
                id="bio"
                className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={form.bio}
                onChange={(e) => setForm({ ...form, bio: e.target.value })}
                placeholder="Tell students about yourself..."
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="institution">Institution</Label>
              <Input
                id="institution"
                value={form.institution}
                onChange={(e) => setForm({ ...form, institution: e.target.value })}
                placeholder="School, college, or coaching center"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="institutionType">I am a...</Label>
              <select
                id="institutionType"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.institutionType}
                onChange={(e) => setForm({ ...form, institutionType: e.target.value })}
              >
                <option value="">Select type</option>
                <option value="school">School / College Teacher</option>
                <option value="tuition">Tuition Center / Coaching</option>
                <option value="independent">Independent Educator</option>
                <option value="student">Student Creator</option>
                <option value="publisher">Publisher / Author</option>
              </select>
            </div>

            <Button type="submit" className="w-full gap-2" disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Register as Creator
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
