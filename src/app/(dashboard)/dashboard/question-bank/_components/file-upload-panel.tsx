"use client";

import { useState, useRef, useCallback } from "react";
import { Upload, FileText, Image as ImageIcon, FileSpreadsheet, File, CheckCircle, Loader2, AlertCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/api-client";
import { CurriculumFilterBar, type CurriculumFilter } from "./curriculum-filter-bar";

interface UploadStatus {
  id: number;
  fileName: string;
  fileType: string;
  processingStatus: string;
  extractedContentIds?: number[] | null;
  metadata?: Record<string, unknown>;
}

const ACCEPTED_TYPES = ".pdf,.jpg,.jpeg,.png,.webp,.csv,.xlsx,.xls,.docx";

const FILE_ICONS: Record<string, typeof FileText> = {
  pdf: FileText,
  image: ImageIcon,
  csv: FileSpreadsheet,
  xlsx: FileSpreadsheet,
  xls: FileSpreadsheet,
  docx: File,
};

function getFileIcon(fileName: string) {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (["jpg", "jpeg", "png", "webp"].includes(ext)) return ImageIcon;
  return FILE_ICONS[ext] ?? File;
}

export function FileUploadPanel() {
  const [_filter, setFilter] = useState<CurriculumFilter>({ subjectId: "", chapterId: "", topicId: "" });
  const [uploads, setUploads] = useState<UploadStatus[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const result = await apiFetch<UploadStatus>("/api/questions/upload", {
        method: "POST",
        body: formData,
      });

      setUploads((prev) => [result, ...prev]);

      // Start polling for status
      pollStatus(result.id);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const pollStatus = useCallback(async (uploadId: number) => {
    const poll = async () => {
      try {
        const status = await apiFetch<UploadStatus>(
          `/api/questions/upload/${uploadId}/status`
        );
        setUploads((prev) =>
          prev.map((u) => (u.id === uploadId ? status : u))
        );

        if (status.processingStatus === "uploaded" || status.processingStatus === "processing") {
          setTimeout(poll, 3000);
        }
      } catch {
        // Stop polling on error
      }
    };
    setTimeout(poll, 2000);
  }, []);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleUpload(file);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleUpload(file);
    e.target.value = "";
  };

  return (
    <div className="space-y-6">
      {/* Curriculum context */}
      <div className="space-y-1.5">
        <Label className="text-xs">Upload context (Board / Grade / Subject)</Label>
        <CurriculumFilterBar onFilterChange={setFilter} showTopic={false} />
      </div>

      {/* Upload zone */}
      <Card>
        <CardContent className="pt-6">
          <div
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer ${
              dragOver
                ? "border-violet-500 bg-violet-50"
                : "border-muted-foreground/25 hover:border-violet-400"
            }`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-sm font-medium mb-1">
              {uploading ? "Uploading..." : "Drop a file here or click to browse"}
            </p>
            <p className="text-xs text-muted-foreground">
              Supports PDF, Image (JPG/PNG), CSV, Excel (.xlsx), Word (.docx)
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Max 20MB per file
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_TYPES}
              className="hidden"
              onChange={handleFileSelect}
            />
          </div>
        </CardContent>
      </Card>

      {/* Upload history */}
      {uploads.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Uploads</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {uploads.map((upload) => {
              const Icon = getFileIcon(upload.fileName);
              const meta = upload.metadata as Record<string, unknown> | undefined;
              const parsedCount = meta?.parsedCount as number | undefined;

              return (
                <div
                  key={upload.id}
                  className="flex items-center gap-3 p-3 border rounded-lg"
                >
                  <Icon className="h-8 w-8 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {upload.fileName}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <StatusBadge status={upload.processingStatus} />
                      {parsedCount !== undefined && (
                        <span className="text-xs text-muted-foreground">
                          {parsedCount} questions found
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Instructions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Supported Formats</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-red-500" />
                <span className="font-medium">PDF</span>
              </div>
              <p className="text-muted-foreground text-xs pl-6">
                Question papers, sample papers, worksheets. Text is extracted
                automatically; scanned PDFs use AI OCR.
              </p>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <ImageIcon className="h-4 w-4 text-blue-500" />
                <span className="font-medium">Image</span>
              </div>
              <p className="text-muted-foreground text-xs pl-6">
                Photos of question papers. AI Vision extracts all questions
                from the image.
              </p>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="h-4 w-4 text-green-500" />
                <span className="font-medium">CSV / Excel</span>
              </div>
              <p className="text-muted-foreground text-xs pl-6">
                Structured question banks. Columns auto-mapped to question
                fields (question, options, answer, marks).
              </p>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <File className="h-4 w-4 text-blue-700" />
                <span className="font-medium">Word (.docx)</span>
              </div>
              <p className="text-muted-foreground text-xs pl-6">
                Word documents with questions. Text extracted and parsed
                using AI.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "uploaded":
      return (
        <Badge variant="secondary" className="text-xs gap-1">
          <Loader2 className="h-3 w-3 animate-spin" /> Queued
        </Badge>
      );
    case "processing":
      return (
        <Badge variant="secondary" className="text-xs gap-1 bg-yellow-100 text-yellow-800">
          <Loader2 className="h-3 w-3 animate-spin" /> Processing
        </Badge>
      );
    case "completed":
      return (
        <Badge variant="secondary" className="text-xs gap-1 bg-green-100 text-green-800">
          <CheckCircle className="h-3 w-3" /> Completed
        </Badge>
      );
    case "failed":
      return (
        <Badge variant="destructive" className="text-xs gap-1">
          <AlertCircle className="h-3 w-3" /> Failed
        </Badge>
      );
    default:
      return <Badge variant="outline" className="text-xs">{status}</Badge>;
  }
}
