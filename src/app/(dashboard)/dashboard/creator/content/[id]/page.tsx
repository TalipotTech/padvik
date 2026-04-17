"use client";

import { useEffect, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Loader2, Save, Globe, ArrowLeft, Eye, Pencil, FileText, FileVideo,
  FileAudio, Image as ImageIcon, Download, Upload, RefreshCw, Camera,
  X, ChevronLeft, ChevronRight, ZoomIn, BookOpen, Trash2, Plus,
} from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import { MarkdownRenderer } from "@/components/content/markdown-renderer";
import { OcrBlockRenderer } from "@/components/content/ocr-block-renderer";
import { ImageLightbox } from "@/components/content/image-lightbox";
import { blocksToMarkdown, type OcrBlock } from "@/lib/content-pipeline/ocr-blocks";

// ── Types ──
interface MediaItem {
  type: "video" | "audio" | "image" | "document";
  url: string;
  fileUploadId: number;
  fileName: string;
  fileSize: number;
  mimeType: string;
  order: number;
  extractedText?: string;
  extractedBlocks?: OcrBlock[];
  duration?: number;
}

interface ContentDetail {
  id: number; contentType: string; title: string; description: string | null;
  body: string | null; mediaUrl: string | null; thumbnailUrl: string | null;
  durationSeconds: number | null; isPublished: boolean; reviewStatus: string;
  isPremium: boolean; language: string; viewCount: number; likeCount: number;
  shareCount: number; createdAt: string; publishedAt: string | null;
  metadata: Record<string, unknown> | null;
  boardName: string | null; boardCode: string | null; standardGrade: number | null;
  subjectName: string | null; chapterTitle: string | null; chapterNumber: number | null;
  topicTitle: string | null;
  mediaItems?: MediaItem[];
}

// ── Helpers ──
function FileIcon({ type, className }: { type: string; className?: string }) {
  const cls = className || "h-5 w-5";
  switch (type) {
    case "video": return <FileVideo className={`${cls} text-blue-500`} />;
    case "audio": return <FileAudio className={`${cls} text-green-500`} />;
    case "image": return <ImageIcon className={`${cls} text-amber-500`} />;
    default: return <FileText className={`${cls} text-red-500`} />;
  }
}

function formatSize(bytes: number): string {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Preview: render mediaItems sequentially ──
// ── PDF Viewer — uses same pattern as syllabus explorer (Dialog + iframe via local-pdf API) ──
function PdfViewer({ url, fileName }: { url: string; fileName: string }) {
  const [showDialog, setShowDialog] = useState(false);

  // The working PDF endpoint is /api/admin/local-pdf — but that requires admin.
  // For creator uploads, we serve from /api/uploads/... which should also work.
  // The key: serve via the same local-pdf pattern by converting the URL to a path query param.
  // Extract the relative path from the URL: /api/uploads/creators/4/file.pdf → data/uploads/creators/4/file.pdf
  const pdfPath = url.startsWith("/api/uploads/")
    ? "data/uploads/" + url.replace("/api/uploads/", "")
    : url;

  return (
    <>
      <div className="p-8 flex flex-col items-center gap-4 bg-muted/10">
        <FileText className="h-16 w-16 text-red-400" />
        <p className="text-sm font-medium">{fileName}</p>
        <div className="flex gap-2">
          <Button variant="default" size="sm" className="gap-1.5" onClick={() => setShowDialog(true)}>
            <Eye className="h-3.5 w-3.5" />
            View PDF
          </Button>
          <a href={url} target="_blank" rel="noopener noreferrer">
            <Button variant="outline" size="sm" className="gap-1.5">
              <Download className="h-3.5 w-3.5" />
              Open in new tab
            </Button>
          </a>
        </div>
      </div>
      {/* PDF Dialog — same pattern as syllabus explorer which works */}
      {showDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowDialog(false)}>
          <div className="bg-background rounded-lg shadow-xl w-[90vw] max-w-4xl h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
              <span className="text-sm font-medium">{fileName}</span>
              <div className="flex gap-2">
                <a href={url} target="_blank" rel="noopener noreferrer">
                  <Button variant="ghost" size="sm" className="gap-1 text-xs"><Download className="h-3 w-3" />New tab</Button>
                </a>
                <Button variant="ghost" size="sm" onClick={() => setShowDialog(false)}><X className="h-4 w-4" /></Button>
              </div>
            </div>
            <iframe
              src={`/api/creator-pdf?path=${encodeURIComponent(pdfPath)}`}
              className="flex-1 w-full border-0"
              title={fileName}
            />
          </div>
        </div>
      )}
    </>
  );
}

function MediaPreview({ items, body, isHandwritten, onOpenLightbox }: {
  items: MediaItem[]; body: string | null; isHandwritten: boolean;
  onOpenLightbox: (idx: number) => void;
}) {
  const imageItems = items.filter(i => i.type === "image");

  return (
    <div className="space-y-4">
      {items.map((item, i) => (
        <div key={`${item.url}-${i}`} className="rounded-lg border bg-card overflow-hidden">
          {item.type === "video" && (
            <>
              <div className="border-b px-4 py-2 flex items-center gap-2 bg-muted/30">
                <FileVideo className="h-4 w-4 text-blue-500" /><span className="text-sm font-medium">Video</span>
                <span className="text-xs text-muted-foreground ml-auto">{item.fileName}</span>
              </div>
              <div className="aspect-video bg-black"><video src={item.url} controls className="w-full h-full" /></div>
            </>
          )}
          {item.type === "audio" && (
            <>
              <div className="border-b px-4 py-2 flex items-center gap-2 bg-muted/30">
                <FileAudio className="h-4 w-4 text-green-500" /><span className="text-sm font-medium">Audio</span>
                <span className="text-xs text-muted-foreground ml-auto">{item.fileName}</span>
              </div>
              <div className="p-4"><audio src={item.url} controls className="w-full" /></div>
            </>
          )}
          {item.type === "image" && (
            <>
              <div className="border-b px-4 py-2 flex items-center gap-2 bg-muted/30">
                <ImageIcon className="h-4 w-4 text-amber-500" /><span className="text-sm font-medium">Image</span>
                <span className="text-xs text-muted-foreground ml-auto">{item.fileName}</span>
              </div>
              {isHandwritten && item.extractedText ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-0">
                  <div className="p-3 bg-muted/20 border-r flex flex-col items-center cursor-pointer group relative" onClick={() => onOpenLightbox(imageItems.indexOf(item))}>
                    <img src={item.url} alt="" className="max-h-[350px] rounded border object-contain" />
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/20 rounded"><ZoomIn className="h-8 w-8 text-white drop-shadow-lg" /></div>
                  </div>
                  <div className="p-4">
                    {item.extractedBlocks ? (
                      <OcrBlockRenderer blocks={item.extractedBlocks} />
                    ) : (
                      <MarkdownRenderer content={item.extractedText} />
                    )}
                  </div>
                </div>
              ) : (
                <div className="p-4 flex justify-center cursor-pointer" onClick={() => onOpenLightbox(imageItems.indexOf(item))}>
                  <img src={item.url} alt="" className="max-h-[400px] rounded border object-contain" />
                </div>
              )}
            </>
          )}
          {item.type === "document" && (
            <>
              <div className="border-b px-4 py-2 flex items-center justify-between bg-muted/30">
                <div className="flex items-center gap-2"><FileText className="h-4 w-4 text-red-500" /><span className="text-sm font-medium">Document</span></div>
                <a href={item.url} target="_blank" rel="noopener noreferrer"><Button variant="ghost" size="sm" className="gap-1 text-xs"><Download className="h-3 w-3" />Open</Button></a>
              </div>
              {item.mimeType === "application/pdf" || item.fileName?.toLowerCase().endsWith(".pdf") ? (
                <PdfViewer url={item.url} fileName={item.fileName} />
              ) : (
                <div className="p-6 flex flex-col items-center gap-2"><FileText className="h-10 w-10 text-muted-foreground" /><p className="text-sm">{item.fileName}</p><p className="text-xs text-muted-foreground">{formatSize(item.fileSize)}</p></div>
              )}
            </>
          )}
        </div>
      ))}
      {/* Text body */}
      {body && (
        <div className="rounded-lg border bg-card">
          <div className="border-b px-4 py-2 flex items-center gap-2 bg-muted/30"><FileText className="h-4 w-4 text-muted-foreground" /><span className="text-sm font-medium">Text Notes</span></div>
          <div className="p-6 max-h-[500px] overflow-y-auto"><MarkdownRenderer content={body} /></div>
        </div>
      )}
    </div>
  );
}

// ── Edit: compact card for non-image items (video, audio, document) ──
function MediaItemEditor({ item, contentId, onRemove, onReplace }: {
  item: MediaItem; contentId: number;
  onRemove: () => void; onReplace: (file: File) => void;
}) {
  const replaceRef = useRef<HTMLInputElement>(null);

  return (
    <div className="rounded-lg border flex items-center gap-3 p-3">
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-muted/50 border overflow-hidden">
        {item.type === "image" ? (
          <img src={item.url} alt="" className="h-full w-full object-cover" />
        ) : (
          <FileIcon type={item.type} className="h-6 w-6" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{item.fileName}</p>
        <p className="text-xs text-muted-foreground capitalize">{item.type} · {formatSize(item.fileSize)}</p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <input ref={replaceRef} type="file" className="hidden" onChange={e => { if (e.target.files?.[0]) onReplace(e.target.files[0]); }} />
        <Button type="button" variant="ghost" size="icon" className="h-8 w-8" title="Replace" onClick={() => replaceRef.current?.click()}>
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
        <a href={item.url} target="_blank" rel="noopener noreferrer">
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8" title="Open"><Download className="h-3.5 w-3.5" /></Button>
        </a>
        <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" title="Remove" onClick={onRemove}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

// ── Edit: Image + OCR text side-by-side editor ──
function ImageOcrEditor({ item, onRemove, onReplace, onTextChange, onOpenLightbox, replacing }: {
  item: MediaItem;
  onRemove: () => void;
  onReplace: (file: File) => void;
  onTextChange: (text: string) => void;
  onOpenLightbox: () => void;
  replacing?: boolean;
}) {
  const replaceRef = useRef<HTMLInputElement>(null);
  const [editMode, setEditMode] = useState<"visual" | "markdown" | "raw">("visual");
  const text = item.extractedText || "";

  return (
    <div className={`rounded-lg border overflow-hidden transition-opacity ${replacing ? "opacity-60 pointer-events-none" : ""}`}>
      {/* Header */}
      <div className="bg-muted/30 px-3 py-2 border-b flex items-center justify-between">
        <div className="flex items-center gap-2">
          {replacing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-500" />
          ) : (
            <ImageIcon className="h-3.5 w-3.5 text-amber-500" />
          )}
          <span className="text-xs font-medium truncate max-w-[200px]">
            {replacing ? "Replacing & re-processing OCR..." : item.fileName}
          </span>
          {!replacing && item.extractedText && <Badge variant="secondary" className="text-[9px] py-0 h-4">OCR</Badge>}
        </div>
        <div className="flex items-center gap-1">
          {item.extractedText && !replacing && (
            <>
              <Button type="button" variant={editMode === "visual" ? "secondary" : "ghost"} size="sm" className="h-6 text-[10px] px-2" onClick={() => setEditMode("visual")}>
                Visual
              </Button>
              <Button type="button" variant={editMode === "markdown" ? "secondary" : "ghost"} size="sm" className="h-6 text-[10px] px-2" onClick={() => setEditMode("markdown")}>
                Markdown
              </Button>
              {item.extractedBlocks && (
                <Button type="button" variant={editMode === "raw" ? "secondary" : "ghost"} size="sm" className="h-6 text-[10px] px-2" onClick={() => setEditMode("raw")}>
                  Raw
                </Button>
              )}
            </>
          )}
          <input ref={replaceRef} type="file" className="hidden" accept="image/*" onChange={e => { if (e.target.files?.[0]) onReplace(e.target.files[0]); }} />
          <Button type="button" variant="ghost" size="icon" className="h-6 w-6" title="Replace image" onClick={() => replaceRef.current?.click()} disabled={replacing}>
            {replacing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          </Button>
          <Button type="button" variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:text-destructive" title="Remove" onClick={onRemove} disabled={replacing}>
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Replacing progress bar */}
      {replacing && (
        <div className="h-1 bg-muted overflow-hidden">
          <div className="h-full bg-violet-500 animate-pulse" style={{ width: "100%" }} />
        </div>
      )}

      {/* Content: image left + text right */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-0">
        {/* Left: Image */}
        <div className="p-3 bg-muted/10 border-r flex flex-col">
          <div className="flex-1 flex items-start justify-center cursor-pointer group relative" onClick={onOpenLightbox}>
            <img src={item.url} alt="" className="max-h-[300px] rounded border object-contain" />
            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/20 rounded">
              <ZoomIn className="h-8 w-8 text-white drop-shadow-lg" />
            </div>
          </div>
        </div>
        {/* Right: Extracted text */}
        <div className="p-3 flex flex-col">
          {item.extractedText ? (
            editMode === "visual" ? (
              <div className="flex-1 min-h-[200px] overflow-y-auto rounded-md border border-transparent px-2 py-2">
                {item.extractedBlocks ? (
                  <OcrBlockRenderer blocks={item.extractedBlocks} />
                ) : (
                  <MarkdownRenderer content={text} />
                )}
              </div>
            ) : editMode === "raw" && item.extractedBlocks ? (
              <pre className="flex-1 min-h-[200px] w-full rounded-md border border-input bg-muted/30 px-3 py-2 text-[11px] font-mono overflow-auto whitespace-pre-wrap">
                {JSON.stringify(item.extractedBlocks, null, 2)}
              </pre>
            ) : (
              <textarea
                className="flex-1 min-h-[200px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y"
                value={item.extractedBlocks ? blocksToMarkdown(item.extractedBlocks) : text}
                onChange={(e) => onTextChange(e.target.value)}
              />
            )
          ) : (
            <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground italic">
              {replacing ? "Processing OCR..." : "No text extracted"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Main Page
// ══════════════════════════════════════════════════════════════════════════════
export default function ContentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [content, setContent] = useState<ContentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", body: "" });
  const [activeTab, setActiveTab] = useState("preview");
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const addFilesRef = useRef<HTMLInputElement>(null);
  const [addingFiles, setAddingFiles] = useState(false);
  const [replacingOrder, setReplacingOrder] = useState<number | null>(null);

  const meta = (content?.metadata as Record<string, unknown>) || {};
  const mediaItems: MediaItem[] = content?.mediaItems || (meta.mediaItems as MediaItem[]) || [];
  const isHandwritten = !!meta.handwritten;
  const imageUrls = mediaItems.filter(i => i.type === "image").map(i => i.url);

  useEffect(() => {
    fetchContent();
  }, [params.id]);

  function fetchContent() {
    fetch(`/api/creators/content/${params.id}`)
      .then(r => r.json())
      .then(res => {
        if (res.success) {
          setContent(res.data);
          setForm({ title: res.data.title, description: res.data.description || "", body: res.data.body || "" });
        }
      })
      .finally(() => setLoading(false));
  }

  async function handleSave() {
    setSaving(true);
    const res = await fetch(`/api/creators/content/${params.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    setSaving(false);
    if (data.success) { toast.success("Content updated"); setContent(data.data); }
    else toast.error(data.error?.message || "Update failed");
  }

  async function togglePublish() {
    const res = await fetch(`/api/creators/content/${params.id}/publish`, { method: "POST" });
    const data = await res.json();
    if (data.success) { toast.success(data.data.isPublished ? "Published!" : "Unpublished"); setContent(data.data); }
  }

  async function handleRemoveMedia(order: number) {
    if (!confirm("Remove this file?")) return;
    const res = await fetch(`/api/creators/content/${params.id}/remove-media`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order }),
    });
    const data = await res.json();
    if (data.success) { toast.success("File removed"); fetchContent(); }
    else toast.error(data.error?.message || "Failed to remove");
  }

  async function handleReplaceMedia(order: number, file: File) {
    setReplacingOrder(order);
    try {
      // Remove old + add new (simplest approach)
      await fetch(`/api/creators/content/${params.id}/remove-media`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order }),
      });
      const fd = new FormData();
      fd.append("files", file);
      if (isHandwritten && file.type.startsWith("image/")) fd.append("handwritten", "true");
      fd.append("language", content?.language || "en");
      const res = await fetch(`/api/creators/content/${params.id}/add-media`, { method: "POST", body: fd });
      const data = await res.json();
      if (data.success) { toast.success("File replaced"); fetchContent(); }
      else toast.error(data.error?.message || "Failed to replace");
    } finally {
      setReplacingOrder(null);
    }
  }

  function handleImageTextChange(order: number, newText: string) {
    // Update extractedText in the local mediaItems and rebuild body
    if (!content) return;
    const meta = (content.metadata as Record<string, unknown>) || {};
    const items: MediaItem[] = content.mediaItems || (meta.mediaItems as MediaItem[]) || [];
    const updated = items.map(item =>
      item.order === order ? { ...item, extractedText: newText } : item
    );
    // Update metadata locally
    const newMeta = { ...meta, mediaItems: updated };
    setContent({ ...content, metadata: newMeta, mediaItems: updated } as ContentDetail);
    // Also rebuild body from all extracted texts
    const imageTexts = updated
      .filter(i => i.type === "image" && i.extractedText)
      .map(i => `![Image](${i.url})\n\n${i.extractedText}`)
      .join("\n\n---\n\n");
    // Preserve non-image body text (anything before the first image block)
    const existingBody = form.body || "";
    const nonImageBody = existingBody.split(/!\[Image\]/)[0]?.trim() || "";
    const newBody = nonImageBody
      ? `${nonImageBody}\n\n---\n\n${imageTexts}`
      : imageTexts;
    setForm(f => ({ ...f, body: newBody }));
  }

  async function handleAddFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setAddingFiles(true);
    const fd = new FormData();
    for (const f of files) fd.append("files", f);
    if (isHandwritten) fd.append("handwritten", "true");
    fd.append("language", content?.language || "en");

    const res = await fetch(`/api/creators/content/${params.id}/add-media`, { method: "POST", body: fd });
    const data = await res.json();
    setAddingFiles(false);
    if (data.success) { toast.success(`${files.length} file(s) added`); fetchContent(); }
    else toast.error(data.error?.message || "Failed to add files");
    if (addFilesRef.current) addFilesRef.current.value = "";
  }

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
  if (!content) return <p className="text-muted-foreground py-10 text-center">Content not found.</p>;

  return (
    <div className="max-w-5xl space-y-6">
      {lightboxIndex !== null && imageUrls.length > 0 && (
        <ImageLightbox images={imageUrls} initialIndex={lightboxIndex} onClose={() => setLightboxIndex(null)} />
      )}

      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/dashboard/creator/content"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold truncate">{content.title}</h1>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <Badge variant="outline" className="capitalize">{content.contentType}</Badge>
            {mediaItems.length > 0 && (
              <Badge variant="secondary" className="text-xs">
                {mediaItems.length} file{mediaItems.length !== 1 ? "s" : ""}
                {isHandwritten && " · Handwritten"}
              </Badge>
            )}
            <Badge variant={content.isPublished ? "default" : "secondary"}>{content.isPublished ? "Published" : "Draft"}</Badge>
            <Badge variant="secondary">{content.reviewStatus}</Badge>
            <span className="text-xs text-muted-foreground ml-auto">{content.viewCount} views · {new Date(content.createdAt).toLocaleDateString()}</span>
          </div>
          {(content.boardCode || content.subjectName) && (
            <div className="flex items-center gap-1.5 mt-1.5">
              <BookOpen className="h-3.5 w-3.5 text-violet-500 shrink-0" />
              <span className="text-sm text-muted-foreground">
                {[content.boardName || content.boardCode, content.standardGrade ? `Class ${content.standardGrade}` : null, content.subjectName, content.chapterTitle ? `Ch ${content.chapterNumber}: ${content.chapterTitle}` : null, content.topicTitle].filter(Boolean).join(" › ")}
              </span>
            </div>
          )}
        </div>
        <Button variant="outline" className="gap-2 shrink-0" onClick={togglePublish}>
          <Globe className="h-4 w-4" />{content.isPublished ? "Unpublish" : "Publish"}
        </Button>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="preview" className="gap-1.5"><Eye className="h-3.5 w-3.5" />Preview</TabsTrigger>
          <TabsTrigger value="edit" className="gap-1.5"><Pencil className="h-3.5 w-3.5" />Edit</TabsTrigger>
        </TabsList>

        {/* ── Preview ── */}
        <TabsContent value="preview" className="space-y-4 mt-4">
          {content.description && <p className="text-sm text-muted-foreground">{content.description}</p>}
          {mediaItems.length > 0 ? (
            <MediaPreview items={mediaItems} body={!isHandwritten ? form.body : null} isHandwritten={isHandwritten} onOpenLightbox={setLightboxIndex} />
          ) : form.body ? (
            <div className="rounded-lg border bg-card p-6"><MarkdownRenderer content={form.body} /></div>
          ) : (
            <div className="rounded-lg border bg-card p-8 text-center text-muted-foreground"><Eye className="h-8 w-8 mx-auto mb-2" /><p className="text-sm">No content to preview.</p></div>
          )}
        </TabsContent>

        {/* ── Edit ── */}
        <TabsContent value="edit" className="space-y-4 mt-4">
          {/* Details */}
          <Card>
            <CardHeader><CardTitle>Details</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2"><Label>Title</Label><Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></div>
              <div className="space-y-2"><Label>Description</Label><textarea className="flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
            </CardContent>
          </Card>

          {/* Media Items — images with OCR get side-by-side editor, others get compact card */}
          {mediaItems.length > 0 && (
            <div className="space-y-3">
              {/* Non-image items (video, audio, document) — compact cards */}
              {mediaItems.filter(i => i.type !== "image").length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Files</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {mediaItems.filter(i => i.type !== "image").map((item, i) => (
                      <MediaItemEditor
                        key={`${item.url}-${i}`}
                        item={item}
                        contentId={content.id}
                        onRemove={() => handleRemoveMedia(item.order)}
                        onReplace={(file) => handleReplaceMedia(item.order, file)}
                      />
                    ))}
                  </CardContent>
                </Card>
              )}

              {/* Image items — side-by-side OCR editor */}
              {mediaItems.filter(i => i.type === "image").length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold flex items-center gap-2">
                    <Camera className="h-4 w-4" />
                    Images ({mediaItems.filter(i => i.type === "image").length})
                    {isHandwritten && <Badge variant="secondary" className="text-[10px]">Handwritten OCR</Badge>}
                  </h3>
                  {mediaItems.filter(i => i.type === "image").map((item, i) => (
                    <ImageOcrEditor
                      key={`${item.url}-${i}`}
                      item={item}
                      onRemove={() => handleRemoveMedia(item.order)}
                      onReplace={(file) => handleReplaceMedia(item.order, file)}
                      onTextChange={(newText) => handleImageTextChange(item.order, newText)}
                      onOpenLightbox={() => setLightboxIndex(i)}
                      replacing={replacingOrder === item.order}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Add more files */}
          <div className="rounded-lg border-2 border-dashed p-4 text-center">
            <input ref={addFilesRef} type="file" className="hidden" accept="video/*,audio/*,image/*,.pdf,.docx,.pptx" multiple onChange={handleAddFiles} />
            <Button type="button" variant="outline" className="gap-2" disabled={addingFiles} onClick={() => addFilesRef.current?.click()}>
              {addingFiles ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              {addingFiles ? "Processing..." : "Add More Files"}
            </Button>
            <p className="text-xs text-muted-foreground mt-2">Video, audio, images, documents</p>
          </div>

          {/* Text Notes */}
          <Card>
            <CardHeader><CardTitle>Text Notes</CardTitle></CardHeader>
            <CardContent>
              <textarea
                className="flex min-h-[200px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={form.body}
                onChange={e => setForm({ ...form, body: e.target.value })}
                placeholder="Text notes, explanations (Markdown supported)..."
              />
            </CardContent>
          </Card>

          <Button onClick={handleSave} disabled={saving} className="gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save Changes
          </Button>
        </TabsContent>
      </Tabs>
    </div>
  );
}
