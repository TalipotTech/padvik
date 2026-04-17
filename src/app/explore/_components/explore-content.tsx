"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PadvikLogo } from "@/components/ui/padvik-logo";
import { ContentCard, type ContentCardProps } from "@/components/content/content-card";
import { CreatorCard, type CreatorCardProps } from "@/components/creators/creator-card";
import { Search, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";

const CONTENT_TYPES = [
  { value: "", label: "All" },
  { value: "video", label: "Video" },
  { value: "audio", label: "Audio" },
  { value: "note", label: "Notes" },
  { value: "document", label: "Documents" },
  { value: "image", label: "Images" },
  { value: "question_set", label: "Questions" },
];

export function ExploreContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [search, setSearch] = useState(searchParams.get("search") ?? "");
  const [contentType, setContentType] = useState(searchParams.get("contentType") ?? "");
  const [page, setPage] = useState(Number(searchParams.get("page")) || 1);

  const [content, setContent] = useState<ContentCardProps[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);

  const [featuredCreators, setFeaturedCreators] = useState<CreatorCardProps[]>([]);

  // Fetch featured creators once
  useEffect(() => {
    fetch("/api/creators/featured?limit=8")
      .then((r) => r.json())
      .then((json) => {
        if (json.success) {
          setFeaturedCreators(
            (json.data.creators ?? []).map((c: Record<string, unknown>) => ({
              userId: c.userId as number,
              displayName: c.displayName as string,
              institution: c.institution as string | null,
              institutionType: c.institutionType as string | null,
              avatarUrl: c.avatarUrl as string | null,
              isVerified: c.creatorVerified as boolean,
              isFeatured: c.isFeatured as boolean,
              followerCount: Number(c.followerCount ?? 0),
              contentCount: Number(c.contentCount ?? 0),
              publishedCount: Number(c.publishedCount ?? 0),
              rating: c.rating as string | null,
            }))
          );
        }
      })
      .catch(() => {});
  }, []);

  // Fetch content with filters
  const fetchContent = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (contentType) params.set("contentType", contentType);
    params.set("page", String(page));
    params.set("limit", "20");

    try {
      const res = await fetch(`/api/content/browse?${params}`);
      const json = await res.json();
      if (json.success) {
        setContent(
          (json.data.items ?? []).map((c: Record<string, unknown>) => ({
            id: c.id as number,
            title: c.title as string,
            contentType: c.contentType as string,
            description: c.description as string | null,
            thumbnailUrl: c.thumbnailUrl as string | null,
            durationSeconds: c.durationSeconds as number | null,
            isPremium: c.isPremium as boolean,
            viewCount: Number(c.viewCount ?? 0),
            likeCount: Number(c.likeCount ?? 0),
            publishedAt: c.publishedAt as string,
            creatorName: c.creatorName as string,
            creatorAvatar: c.creatorAvatar as string | null,
            creatorVerified: c.creatorVerified as boolean,
            creatorId: c.creatorId as number,
          }))
        );
        setTotalPages(json.data.pagination?.totalPages ?? 1);
      }
    } catch {
      // Silent fail
    } finally {
      setLoading(false);
    }
  }, [search, contentType, page]);

  useEffect(() => {
    fetchContent();
  }, [fetchContent]);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    // Update URL params
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (contentType) params.set("contentType", contentType);
    router.push(`/explore?${params.toString()}`);
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Navbar */}
      <nav className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
          <Link href="/">
            <PadvikLogo size="md" />
          </Link>
          <div className="flex items-center gap-3">
            <Link href="/creators">
              <Button variant="ghost" size="sm">Teach on Padvik</Button>
            </Link>
            <Link href="/login">
              <Button size="sm">Sign In</Button>
            </Link>
          </div>
        </div>
      </nav>

      <div className="mx-auto max-w-7xl px-4 py-8">
        {/* Header + Search */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold">Explore Content</h1>
          <p className="text-muted-foreground mt-1">Discover educational content from our creator community</p>

          <form onSubmit={handleSearch} className="mt-4 flex gap-2 max-w-lg">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search content..."
                className="pl-9"
              />
            </div>
            <Button type="submit" variant="secondary">Search</Button>
          </form>
        </div>

        {/* Featured Creators Row */}
        {featuredCreators.length > 0 && !search && page === 1 && (
          <div className="mb-8">
            <h2 className="text-lg font-semibold mb-3">Featured Educators</h2>
            <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
              {featuredCreators.map((creator) => (
                <div key={creator.userId} className="shrink-0 w-[160px]">
                  <CreatorCard {...creator} />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Content Type Tabs */}
        <div className="flex gap-2 mb-6 overflow-x-auto pb-1">
          {CONTENT_TYPES.map((ct) => (
            <Button
              key={ct.value}
              variant={contentType === ct.value ? "default" : "outline"}
              size="sm"
              onClick={() => { setContentType(ct.value); setPage(1); }}
              className="shrink-0"
            >
              {ct.label}
            </Button>
          ))}
        </div>

        {/* Content Grid */}
        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : content.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-lg font-medium">No content found</p>
            <p className="text-sm text-muted-foreground mt-1">Try adjusting your search or filters</p>
          </div>
        ) : (
          <>
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
              {content.map((item) => (
                <ContentCard key={item.id} {...item} />
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-3 mt-8">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft className="h-4 w-4" /> Previous
                </Button>
                <span className="text-sm text-muted-foreground">
                  Page {page} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <footer className="border-t py-8 mt-12">
        <div className="mx-auto max-w-7xl px-4 flex items-center justify-between">
          <PadvikLogo size="sm" />
          <p className="text-xs text-muted-foreground">&copy; {new Date().getFullYear()} Ensate Technologies. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
