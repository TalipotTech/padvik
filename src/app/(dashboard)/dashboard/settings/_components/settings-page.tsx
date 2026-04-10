"use client";

import { useEffect, useState, useRef } from "react";
import { Moon, Sun, Monitor, Camera, CheckCircle, AlertCircle, Mail, Phone, Shield, User, Users, MapPin, Loader2, Save } from "lucide-react";
import { useTheme } from "next-themes";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { BoardPicker } from "@/components/layout/board-picker";
import { useBoardSelection } from "@/hooks/use-board-selection";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface UserProfile {
  id: number; fullName: string; email: string | null; phone: string | null;
  avatarUrl: string | null; role: string; institution: string | null;
  boardId: number | null; standardId: number | null; grade: number | null;
  boardCode: string | null; boardName: string | null;
  emailVerified: boolean; phoneVerified: boolean; isCreator: boolean;
  guardianName: string | null; guardianPhone: string | null;
  guardianEmail: string | null; guardianRelation: string | null;
  dateOfBirth: string | null; gender: string | null;
  city: string | null; state: string | null; createdAt: string;
}

export function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const { boardName, grade, clearSelection } = useBoardSelection();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const avatarRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({
    fullName: "", phone: "", institution: "",
    dateOfBirth: "", gender: "", city: "", state: "",
    guardianName: "", guardianPhone: "", guardianEmail: "", guardianRelation: "",
  });

  useEffect(() => {
    fetch("/api/user/profile")
      .then(r => r.json())
      .then(res => {
        if (res.success) {
          setProfile(res.data);
          setForm({
            fullName: res.data.fullName || "",
            phone: res.data.phone || "",
            institution: res.data.institution || "",
            dateOfBirth: res.data.dateOfBirth || "",
            gender: res.data.gender || "",
            city: res.data.city || "",
            state: res.data.state || "",
            guardianName: res.data.guardianName || "",
            guardianPhone: res.data.guardianPhone || "",
            guardianEmail: res.data.guardianEmail || "",
            guardianRelation: res.data.guardianRelation || "",
          });
        }
      })
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    setSaving(true);
    const res = await fetch("/api/user/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fullName: form.fullName || undefined,
        phone: form.phone || null,
        institution: form.institution || null,
        dateOfBirth: form.dateOfBirth || null,
        gender: form.gender || null,
        city: form.city || null,
        state: form.state || null,
        guardianName: form.guardianName || null,
        guardianPhone: form.guardianPhone || null,
        guardianEmail: form.guardianEmail || null,
        guardianRelation: form.guardianRelation || null,
      }),
    });
    const data = await res.json();
    setSaving(false);
    if (data.success) toast.success("Profile saved");
    else toast.error(data.error?.message || "Failed to save");
  }

  async function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingAvatar(true);
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/user/avatar", { method: "POST", body: fd });
    const data = await res.json();
    setUploadingAvatar(false);
    if (data.success) {
      toast.success("Photo updated");
      setProfile(p => p ? { ...p, avatarUrl: data.data.avatarUrl } : p);
    } else toast.error(data.error?.message || "Upload failed");
    if (avatarRef.current) avatarRef.current.value = "";
  }

  async function handleVerifyEmail() {
    const res = await fetch("/api/user/verify-email", { method: "POST" });
    const data = await res.json();
    if (data.success) {
      toast.success("Email verified!");
      setProfile(p => p ? { ...p, emailVerified: true } : p);
    } else toast.error(data.error?.message || "Verification failed");
  }

  async function handleVerifyPhone() {
    if (!form.phone) { toast.error("Add a phone number first"); return; }
    // Save phone first if changed
    if (form.phone !== profile?.phone) {
      await fetch("/api/user/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: form.phone }),
      });
    }
    const res = await fetch("/api/user/verify-phone", { method: "POST" });
    const data = await res.json();
    if (data.success) {
      toast.success("Phone verified!");
      setProfile(p => p ? { ...p, phoneVerified: true } : p);
    } else toast.error(data.error?.message || "Verification failed");
  }

  const themes = [
    { value: "light", label: "Light", icon: Sun },
    { value: "dark", label: "Dark", icon: Moon },
    { value: "system", label: "System", icon: Monitor },
  ] as const;

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
  if (!profile) return <p className="text-center py-10 text-muted-foreground">Failed to load profile.</p>;

  const initials = profile.fullName?.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2) || "U";
  const isStudent = profile.role === "student";

  return (
    <div className="space-y-6 pt-2 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold">Profile & Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage your account</p>
      </div>

      {/* Profile Photo + Name */}
      <Card>
        <CardContent className="py-6">
          <div className="flex items-center gap-6">
            <div className="relative group">
              <Avatar className="h-20 w-20">
                <AvatarImage src={profile.avatarUrl || undefined} />
                <AvatarFallback className="text-2xl bg-primary/10 text-primary">{initials}</AvatarFallback>
              </Avatar>
              <button
                onClick={() => avatarRef.current?.click()}
                className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                disabled={uploadingAvatar}
              >
                {uploadingAvatar ? <Loader2 className="h-5 w-5 text-white animate-spin" /> : <Camera className="h-5 w-5 text-white" />}
              </button>
              <input ref={avatarRef} type="file" className="hidden" accept="image/jpeg,image/png,image/webp" onChange={handleAvatarUpload} />
            </div>
            <div className="flex-1">
              <div className="space-y-1.5">
                <Label>Full Name</Label>
                <Input value={form.fullName} onChange={e => setForm({ ...form, fullName: e.target.value })} placeholder="Your name" />
              </div>
              <div className="flex items-center gap-2 mt-2">
                <Badge variant="secondary" className="capitalize">{profile.role}</Badge>
                {profile.isCreator && <Badge variant="default">Creator</Badge>}
                <span className="text-xs text-muted-foreground">Joined {new Date(profile.createdAt).toLocaleDateString()}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Contact & Verification */}
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Shield className="h-4 w-4" />Contact & Verification</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {/* Email */}
          <div className="space-y-1.5">
            <Label className="flex items-center gap-2">
              <Mail className="h-3.5 w-3.5" />Email
              {profile.emailVerified ? (
                <Badge variant="default" className="text-[10px] gap-1 py-0 h-5"><CheckCircle className="h-3 w-3" />Verified</Badge>
              ) : profile.email ? (
                <Badge variant="destructive" className="text-[10px] gap-1 py-0 h-5"><AlertCircle className="h-3 w-3" />Not Verified</Badge>
              ) : null}
            </Label>
            <div className="flex gap-2">
              <Input value={profile.email || ""} disabled placeholder="No email" className="bg-muted/50" />
              {profile.email && !profile.emailVerified && (
                <Button variant="outline" size="sm" className="shrink-0" onClick={handleVerifyEmail}>Verify</Button>
              )}
            </div>
          </div>

          {/* Phone */}
          <div className="space-y-1.5">
            <Label className="flex items-center gap-2">
              <Phone className="h-3.5 w-3.5" />Phone
              {profile.phoneVerified ? (
                <Badge variant="default" className="text-[10px] gap-1 py-0 h-5"><CheckCircle className="h-3 w-3" />Verified</Badge>
              ) : form.phone ? (
                <Badge variant="destructive" className="text-[10px] gap-1 py-0 h-5"><AlertCircle className="h-3 w-3" />Not Verified</Badge>
              ) : null}
            </Label>
            <div className="flex gap-2">
              <Input type="tel" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="+91 98765 43210" />
              {form.phone && !profile.phoneVerified && (
                <Button variant="outline" size="sm" className="shrink-0" onClick={handleVerifyPhone}>Verify</Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Personal Info */}
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><User className="h-4 w-4" />Personal Info</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Date of Birth</Label>
              <Input type="date" value={form.dateOfBirth} onChange={e => setForm({ ...form, dateOfBirth: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Gender</Label>
              <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.gender} onChange={e => setForm({ ...form, gender: e.target.value })}>
                <option value="">Select</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Institution / School</Label>
            <Input value={form.institution} onChange={e => setForm({ ...form, institution: e.target.value })} placeholder="School or college name" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>City</Label>
              <Input value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} placeholder="City" />
            </div>
            <div className="space-y-1.5">
              <Label>State</Label>
              <Input value={form.state} onChange={e => setForm({ ...form, state: e.target.value })} placeholder="State" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Guardian Info — students only */}
      {isStudent && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-4 w-4" />Guardian / Parent Info
              {!form.guardianName && <Badge variant="outline" className="text-[10px]">Optional</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Guardian Name</Label>
                <Input value={form.guardianName} onChange={e => setForm({ ...form, guardianName: e.target.value })} placeholder="Parent or guardian name" />
              </div>
              <div className="space-y-1.5">
                <Label>Relation</Label>
                <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.guardianRelation} onChange={e => setForm({ ...form, guardianRelation: e.target.value })}>
                  <option value="">Select</option>
                  <option value="father">Father</option>
                  <option value="mother">Mother</option>
                  <option value="guardian">Guardian</option>
                  <option value="other">Other</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Guardian Phone</Label>
                <Input type="tel" value={form.guardianPhone} onChange={e => setForm({ ...form, guardianPhone: e.target.value })} placeholder="+91 98765 43210" />
              </div>
              <div className="space-y-1.5">
                <Label>Guardian Email</Label>
                <Input type="email" value={form.guardianEmail} onChange={e => setForm({ ...form, guardianEmail: e.target.value })} placeholder="parent@email.com" />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Board & Class */}
      <Card>
        <CardHeader><CardTitle className="text-base">Board & Class</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {boardName ? (
            <div className="flex items-center gap-3">
              <div className="flex gap-2">
                <Badge variant="secondary">{boardName}</Badge>
                {grade && <Badge variant="outline">Class {grade}</Badge>}
              </div>
              <Button variant="outline" size="sm" onClick={() => setPickerOpen(true)}>Change</Button>
              <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={clearSelection}>Clear</Button>
            </div>
          ) : (
            <div>
              <p className="text-sm text-muted-foreground mb-2">No board selected. Choose your board and class.</p>
              <Button variant="outline" size="sm" onClick={() => setPickerOpen(true)}>Select Board & Class</Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Theme */}
      <Card>
        <CardHeader><CardTitle className="text-base">Appearance</CardTitle></CardHeader>
        <CardContent>
          <div className="flex gap-2">
            {themes.map(t => (
              <Button key={t.value} variant={theme === t.value ? "default" : "outline"} size="sm" className="gap-1.5 flex-1" onClick={() => setTheme(t.value)}>
                <t.icon className="h-4 w-4" />{t.label}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Save */}
      <Button onClick={handleSave} disabled={saving} className="gap-2">
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        Save Profile
      </Button>

      <BoardPicker open={pickerOpen} onOpenChange={setPickerOpen} />
    </div>
  );
}
