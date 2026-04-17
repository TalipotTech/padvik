"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Upload, Loader2, FileVideo, FileAudio, FileText, Image as ImageIcon,
  Camera, X, Sparkles, GripVertical,
} from "lucide-react";
import { toast } from "sonner";

// ── Types ──
interface Board { id: number; code: string; name: string }
interface Standard { id: number; grade: number; stream: string | null }
interface Subject { id: number; name: string; chapters?: Chapter[] }
interface Chapter { id: number; title: string; chapterNumber: number; topics?: Topic[] }
interface Topic { id: number; title: string }

interface SelectedFile {
  file: File;
  preview: string; // blob URL for images, empty for others
  type: "video" | "audio" | "image" | "document";
}

function getFileType(file: File): SelectedFile["type"] {
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  if (file.type.startsWith("image/")) return "image";
  return "document";
}

function FileTypeIcon({ type, className }: { type: string; className?: string }) {
  const cls = className || "h-5 w-5";
  switch (type) {
    case "video": return <FileVideo className={`${cls} text-blue-500`} />;
    case "audio": return <FileAudio className={`${cls} text-green-500`} />;
    case "image": return <ImageIcon className={`${cls} text-amber-500`} />;
    default: return <FileText className={`${cls} text-red-500`} />;
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Curriculum Cascade ──
function useCurriculumCascade() {
  const [boards, setBoards] = useState<Board[]>([]);
  const [standards, setStandards] = useState<Standard[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [boardId, setBoardId] = useState("");
  const [standardId, setStandardId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [chapterId, setChapterId] = useState("");
  const [topicId, setTopicId] = useState("");

  useEffect(() => {
    fetch("/api/boards").then(r => r.json()).then(res => {
      setBoards(res.success ? res.data : Array.isArray(res) ? res : []);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!boardId) { setStandards([]); return; }
    fetch(`/api/boards/${boardId}/standards`).then(r => r.json()).then(res => {
      setStandards(res.success ? res.data : Array.isArray(res) ? res : []);
    }).catch(() => setStandards([]));
  }, [boardId]);

  useEffect(() => {
    if (!boardId || !standardId) { setSubjects([]); return; }
    const std = standards.find(s => String(s.id) === standardId);
    if (!std) { setSubjects([]); return; }
    fetch(`/api/boards/${boardId}/subjects?grade=${std.grade}${std.stream ? `&stream=${std.stream}` : ""}`)
      .then(r => r.json()).then(res => { setSubjects(res.success ? res.data : Array.isArray(res) ? res : []); })
      .catch(() => setSubjects([]));
  }, [boardId, standardId, standards]);

  const selectedSubject = subjects.find(s => String(s.id) === subjectId);
  const selectedChapter = selectedSubject?.chapters?.find(c => String(c.id) === chapterId);

  return {
    boards, standards, subjects, selectedSubject, selectedChapter,
    boardId, standardId, subjectId, chapterId, topicId,
    setBoardId: (v: string) => { setBoardId(v); setStandardId(""); setSubjectId(""); setChapterId(""); setTopicId(""); },
    setStandardId: (v: string) => { setStandardId(v); setSubjectId(""); setChapterId(""); setTopicId(""); },
    setSubjectId: (v: string) => { setSubjectId(v); setChapterId(""); setTopicId(""); },
    setChapterId: (v: string) => { setChapterId(v); setTopicId(""); },
    setTopicId,
  };
}

// ── Main Page ──
export default function ContentUploadPage() {
  const router = useRouter();
  const curriculum = useCurriculumCascade();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<SelectedFile[]>([]);
  const [handwritten, setHandwritten] = useState(false);
  const [ocrModel, setOcrModel] = useState("gemini-2.5-pro");
  const [form, setForm] = useState({
    title: "", description: "", body: "", language: "en", isPremium: false,
  });

  const hasImages = selectedFiles.some(f => f.type === "image");

  function handleFilesSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const newFiles = Array.from(e.target.files || []).map(file => ({
      file,
      preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : "",
      type: getFileType(file),
    }));
    setSelectedFiles(prev => [...prev, ...newFiles].slice(0, 20));
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removeFile(index: number) {
    setSelectedFiles(prev => {
      if (prev[index].preview) URL.revokeObjectURL(prev[index].preview);
      return prev.filter((_, i) => i !== index);
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (selectedFiles.length === 0 && !form.body.trim()) {
      toast.error("Add at least one file or some text content");
      return;
    }
    setUploading(true);

    const fd = new FormData();
    fd.append("title", form.title);
    if (form.description) fd.append("description", form.description);
    if (form.body) fd.append("body", form.body);
    fd.append("language", form.language);
    fd.append("isPremium", String(form.isPremium));
    if (handwritten) fd.append("handwritten", "true");
    if (handwritten) fd.append("ocrModel", ocrModel);
    if (curriculum.boardId) fd.append("boardId", curriculum.boardId);
    if (curriculum.standardId) fd.append("standardId", curriculum.standardId);
    if (curriculum.subjectId) fd.append("subjectId", curriculum.subjectId);
    if (curriculum.chapterId) fd.append("chapterId", curriculum.chapterId);
    if (curriculum.topicId) fd.append("topicId", curriculum.topicId);
    for (const sf of selectedFiles) {
      fd.append("files", sf.file);
    }

    const res = await fetch("/api/creators/content/upload", { method: "POST", body: fd });
    const data = await res.json();
    setUploading(false);

    if (data.success) {
      toast.success("Content uploaded!");
      router.push(`/dashboard/creator/content/${data.data.id}`);
    } else {
      toast.error(data.error?.message || "Upload failed");
    }
  }

  // Summary of selected files by type
  const typeCounts = selectedFiles.reduce<Record<string, number>>((acc, f) => {
    acc[f.type] = (acc[f.type] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">Upload Content</h1>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Drop Zone */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Files</span>
              {selectedFiles.length > 0 && (
                <span className="text-xs font-normal text-muted-foreground">
                  {selectedFiles.length} file{selectedFiles.length !== 1 ? "s" : ""} ·{" "}
                  {Object.entries(typeCounts).map(([t, c]) => `${c} ${t}`).join(", ")}
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* File grid */}
            {selectedFiles.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {selectedFiles.map((sf, i) => (
                  <div key={i} className="relative group rounded-lg border overflow-hidden bg-muted/30">
                    {/* Preview */}
                    <div className="aspect-square flex items-center justify-center p-2">
                      {sf.preview ? (
                        <img src={sf.preview} alt={sf.file.name} className="w-full h-full object-cover rounded" />
                      ) : (
                        <div className="flex flex-col items-center gap-1">
                          <FileTypeIcon type={sf.type} className="h-10 w-10" />
                        </div>
                      )}
                    </div>
                    {/* Info overlay */}
                    <div className="px-2 py-1.5 border-t bg-background">
                      <p className="text-[10px] font-medium truncate">{sf.file.name}</p>
                      <p className="text-[9px] text-muted-foreground">{formatSize(sf.file.size)} · {sf.type}</p>
                    </div>
                    {/* Remove button */}
                    <button
                      type="button"
                      onClick={() => removeFile(i)}
                      className="absolute top-1 right-1 bg-black/60 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Add files button */}
            <div
              className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-8 w-8 mx-auto text-muted-foreground" />
              <p className="text-sm mt-2">{selectedFiles.length === 0 ? "Click to add files" : "Add more files"}</p>
              <p className="text-xs text-muted-foreground mt-1">
                Video, audio, images, PDF, DOCX, PPTX — up to 20 files
              </p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept="video/*,audio/*,image/*,.pdf,.docx,.pptx,.doc,.ppt"
              multiple
              onChange={handleFilesSelected}
            />

            {/* Handwritten toggle — only show if images are selected */}
            {hasImages && (
              <div className="space-y-2">
                <label className="flex items-center gap-3 rounded-lg border p-3 cursor-pointer hover:bg-muted/30 transition-colors">
                  <input
                    type="checkbox"
                    checked={handwritten}
                    onChange={(e) => setHandwritten(e.target.checked)}
                    className="rounded"
                  />
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-violet-500" />
                    <div>
                      <p className="text-sm font-medium">Extract text from images (AI OCR)</p>
                      <p className="text-xs text-muted-foreground">For handwritten notes — supports English, Hindi, Malayalam, Tamil, Telugu, Kannada</p>
                    </div>
                  </div>
                </label>

                {/* OCR Model selector — only shown when handwritten is enabled */}
                {handwritten && (
                  <div className="rounded-lg border p-3 space-y-2 bg-muted/20">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex-1">
                        <Label className="text-sm font-medium">OCR Model</Label>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Gemini 2.5 Pro recommended for handwriting. Will auto-failover if the selected model fails.
                        </p>
                      </div>
                      <Select value={ocrModel} onValueChange={setOcrModel}>
                        <SelectTrigger className="w-[260px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="gemini-2.5-pro">Gemini 2.5 Pro (best for vision)</SelectItem>
                          <SelectItem value="gemini-2.5-flash">Gemini 2.5 Flash (fast)</SelectItem>
                          <SelectItem value="claude-sonnet-4-6">Claude Sonnet 4.6 (Anthropic)</SelectItem>
                          <SelectItem value="gemma-3-27b-it">Gemma 3 27B (may not support vision)</SelectItem>
                          <SelectItem value="gemma-3-12b-it">Gemma 3 12B (may not support vision)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Text Notes */}
        <Card>
          <CardHeader><CardTitle>Text Notes (optional)</CardTitle></CardHeader>
          <CardContent>
            <textarea
              className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
              placeholder="Add text notes, explanations, or descriptions (Markdown supported)..."
            />
          </CardContent>
        </Card>

        {/* Details */}
        <Card>
          <CardHeader><CardTitle>Details</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Title *</Label>
              <Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Title of your content" required minLength={2} />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <textarea className="flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Brief description for students" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Language</Label>
                <Select value={form.language} onValueChange={v => setForm({ ...form, language: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="en">English</SelectItem><SelectItem value="hi">Hindi</SelectItem>
                    <SelectItem value="ml">Malayalam</SelectItem><SelectItem value="ta">Tamil</SelectItem>
                    <SelectItem value="te">Telugu</SelectItem><SelectItem value="kn">Kannada</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end">
                <Label className="flex items-center gap-2 h-10 cursor-pointer">
                  <input type="checkbox" checked={form.isPremium} onChange={e => setForm({ ...form, isPremium: e.target.checked })} className="rounded" />
                  <span className="text-sm">Premium</span>
                </Label>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Curriculum Tagging */}
        <Card>
          <CardHeader><CardTitle>Curriculum Tagging</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">Tag to the curriculum so students find it via their syllabus.</p>
            <div className="space-y-2.5">
              <Select value={curriculum.boardId} onValueChange={curriculum.setBoardId}>
                <SelectTrigger><SelectValue placeholder="Select Board" /></SelectTrigger>
                <SelectContent>{curriculum.boards.map(b => <SelectItem key={b.id} value={String(b.id)}>{b.name} ({b.code})</SelectItem>)}</SelectContent>
              </Select>
              {curriculum.boardId && curriculum.standards.length > 0 && (
                <Select value={curriculum.standardId} onValueChange={curriculum.setStandardId}>
                  <SelectTrigger><SelectValue placeholder="Select Class" /></SelectTrigger>
                  <SelectContent>{curriculum.standards.map(s => <SelectItem key={s.id} value={String(s.id)}>Class {s.grade}{s.stream ? ` — ${s.stream}` : ""}</SelectItem>)}</SelectContent>
                </Select>
              )}
              {curriculum.standardId && curriculum.subjects.length > 0 && (
                <Select value={curriculum.subjectId} onValueChange={curriculum.setSubjectId}>
                  <SelectTrigger><SelectValue placeholder="Select Subject" /></SelectTrigger>
                  <SelectContent>{curriculum.subjects.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}</SelectContent>
                </Select>
              )}
              {curriculum.subjectId && (curriculum.selectedSubject?.chapters ?? []).length > 0 && (
                <Select value={curriculum.chapterId} onValueChange={curriculum.setChapterId}>
                  <SelectTrigger><SelectValue placeholder="Select Chapter" /></SelectTrigger>
                  <SelectContent>{(curriculum.selectedSubject?.chapters ?? []).map(ch => <SelectItem key={ch.id} value={String(ch.id)}>Ch {ch.chapterNumber}: {ch.title}</SelectItem>)}</SelectContent>
                </Select>
              )}
              {curriculum.chapterId && (curriculum.selectedChapter?.topics ?? []).length > 0 && (
                <Select value={curriculum.topicId} onValueChange={curriculum.setTopicId}>
                  <SelectTrigger><SelectValue placeholder="Select Topic" /></SelectTrigger>
                  <SelectContent>{(curriculum.selectedChapter?.topics ?? []).map(t => <SelectItem key={t.id} value={String(t.id)}>{t.title}</SelectItem>)}</SelectContent>
                </Select>
              )}
            </div>
          </CardContent>
        </Card>

        <Button type="submit" className="w-full gap-2" disabled={uploading}>
          {uploading ? (
            <><Loader2 className="h-4 w-4 animate-spin" />Uploading {selectedFiles.length} file{selectedFiles.length !== 1 ? "s" : ""}...</>
          ) : (
            <><Upload className="h-4 w-4" />Upload Content{selectedFiles.length > 0 ? ` (${selectedFiles.length} file${selectedFiles.length !== 1 ? "s" : ""})` : ""}</>
          )}
        </Button>
      </form>
    </div>
  );
}
