"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, Home } from "lucide-react";
import { cn } from "@/lib/utils";

const routeLabels: Record<string, string> = {
  dashboard: "Dashboard",
  syllabus: "Syllabus",
  learn: "Learn",
  exams: "Exams",
  chat: "AI Chat",
  analytics: "Analytics",
  settings: "Settings",
  classroom: "Classroom",
  classrooms: "Classrooms",
  creator: "Creator",
  doubts: "Doubts",
  content: "Content",
  upload: "Upload",
  profile: "Profile",
  ask: "Ask",
  schools: "Schools",
  "question-bank": "Question Bank",
  "question-papers": "Question Papers",
  "question-viewer": "Question Viewer",
  "question-paper-verifier": "Paper Verifier",
  "scrape-jobs": "Scrape Jobs",
  curriculum: "Curriculum Explorer",
  "syllabus-viewer": "Syllabus Viewer",
  "creator-register": "Creator Register",
};

// Pages shared between students and creators — detect creator context
// and rewrite breadcrumb links accordingly
const creatorOverrides: Record<string, string> = {
  "/dashboard/doubts": "/dashboard/creator/doubts",
  "/dashboard/content": "/dashboard/creator/content",
};

export function Breadcrumbs() {
  const pathname = usePathname();

  // Detect creator context for breadcrumb link overrides
  const isCreatorContext = typeof window !== "undefined" &&
    (pathname.includes("/creator/") ||
     localStorage.getItem("padvik-last-role") === "creator");

  // Split and filter out empty segments
  const segments = pathname.split("/").filter(Boolean);

  // Build breadcrumb items
  const crumbs = segments.map((segment, index) => {
    let href = "/" + segments.slice(0, index + 1).join("/");
    const label =
      routeLabels[segment] ||
      segment
        .replace(/-/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
    const isLast = index === segments.length - 1;

    // Override href for creator context on shared pages
    if (isCreatorContext && creatorOverrides[href]) {
      href = creatorOverrides[href];
    }

    return { href, label, isLast };
  });

  if (crumbs.length <= 1) return null;

  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-sm text-muted-foreground">
      <Link
        href="/dashboard"
        className="flex items-center hover:text-foreground transition-colors"
      >
        <Home className="h-3.5 w-3.5" />
      </Link>
      {crumbs.slice(1).map((crumb) => (
        <span key={crumb.href} className="flex items-center gap-1">
          <ChevronRight className="h-3.5 w-3.5" />
          {crumb.isLast ? (
            <span className={cn("font-medium text-foreground")}>{crumb.label}</span>
          ) : (
            <Link
              href={crumb.href}
              className="hover:text-foreground transition-colors"
            >
              {crumb.label}
            </Link>
          )}
        </span>
      ))}
    </nav>
  );
}
