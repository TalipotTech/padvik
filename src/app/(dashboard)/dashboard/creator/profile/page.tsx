"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";

interface ProfileData {
  displayName: string;
  bio: string | null;
  institution: string | null;
  institutionType: string | null;
  boards: string[];
  subjects: string[];
  classesFrom: number | null;
  classesTo: number | null;
  websiteUrl: string | null;
}

export default function CreatorProfilePage() {
  const router = useRouter();
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/creators/profile")
      .then((r) => r.json())
      .then((res) => {
        if (res.success) setProfile(res.data);
      })
      .finally(() => setLoading(false));
  }, []);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!profile) return;

    setSaving(true);
    const res = await fetch("/api/creators/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(profile),
    });
    const data = await res.json();
    setSaving(false);

    if (data.success) {
      toast.success("Profile updated successfully");
      router.refresh();
    } else {
      toast.error(data.error?.message || "Failed to update profile");
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!profile) {
    return <p className="text-muted-foreground py-10 text-center">Profile not found.</p>;
  }

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">Edit Creator Profile</h1>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Basic Info</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="displayName">Display Name</Label>
              <Input
                id="displayName"
                value={profile.displayName}
                onChange={(e) => setProfile({ ...profile, displayName: e.target.value })}
                required
                minLength={2}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="bio">Bio</Label>
              <textarea
                id="bio"
                className="flex min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                value={profile.bio || ""}
                onChange={(e) => setProfile({ ...profile, bio: e.target.value })}
                placeholder="Tell students about yourself..."
                maxLength={2000}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="institution">Institution</Label>
              <Input
                id="institution"
                value={profile.institution || ""}
                onChange={(e) => setProfile({ ...profile, institution: e.target.value })}
                placeholder="School, college, or coaching center"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="institutionType">Institution Type</Label>
                <select
                  id="institutionType"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={profile.institutionType || ""}
                  onChange={(e) => setProfile({ ...profile, institutionType: e.target.value || null })}
                >
                  <option value="">Select type</option>
                  <option value="school">School</option>
                  <option value="tuition">Tuition Center</option>
                  <option value="independent">Independent Teacher</option>
                  <option value="publisher">Publisher</option>
                  <option value="student">Student Creator</option>
                </select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="websiteUrl">Website URL</Label>
                <Input
                  id="websiteUrl"
                  type="url"
                  value={profile.websiteUrl || ""}
                  onChange={(e) => setProfile({ ...profile, websiteUrl: e.target.value || null })}
                  placeholder="https://..."
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="classesFrom">Classes From</Label>
                <Input
                  id="classesFrom"
                  type="number"
                  min={1}
                  max={12}
                  value={profile.classesFrom ?? ""}
                  onChange={(e) => setProfile({ ...profile, classesFrom: e.target.value ? Number(e.target.value) : null })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="classesTo">Classes To</Label>
                <Input
                  id="classesTo"
                  type="number"
                  min={1}
                  max={12}
                  value={profile.classesTo ?? ""}
                  onChange={(e) => setProfile({ ...profile, classesTo: e.target.value ? Number(e.target.value) : null })}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Button type="submit" disabled={saving} className="gap-2">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save Profile
        </Button>
      </form>
    </div>
  );
}
