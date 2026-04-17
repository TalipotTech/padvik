"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BarChart3, Eye, Users, FileText, HelpCircle, Loader2, TrendingUp } from "lucide-react";

interface CreatorStats {
  displayName: string;
  followerCount: number;
  contentCount: number;
  totalViews: number;
}

interface ContentStat {
  id: number; title: string; contentType: string;
  viewCount: number; likeCount: number; doubtCount: number;
  isPublished: boolean; createdAt: string;
}

export default function AnalyticsPage() {
  const [stats, setStats] = useState<CreatorStats | null>(null);
  const [topContent, setTopContent] = useState<ContentStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCreator, setIsCreator] = useState(false);

  useEffect(() => {
    // Check if user is a creator
    fetch("/api/creators/profile")
      .then(r => r.json())
      .then(res => {
        if (res.success) {
          setIsCreator(true);
          setStats(res.data);
          // Fetch content for top content list
          return fetch("/api/creators/content?limit=10").then(r => r.json());
        }
        return null;
      })
      .then(res => {
        if (res?.success) setTopContent(res.data.items || []);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;

  if (!isCreator) {
    return (
      <div className="space-y-6 pt-2">
        <h1 className="text-2xl font-bold">Analytics</h1>
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <BarChart3 className="h-10 w-10 text-muted-foreground/40" />
            <p className="font-medium">Student analytics coming soon</p>
            <p className="text-sm text-muted-foreground max-w-sm">
              Track your learning progress, subject mastery, and exam performance.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Sort content by views
  const sorted = [...topContent].sort((a, b) => (b.viewCount || 0) - (a.viewCount || 0));

  return (
    <div className="space-y-6 pt-2">
      <div>
        <h1 className="text-2xl font-bold">Creator Analytics</h1>
        <p className="text-sm text-muted-foreground mt-1">Track your content performance</p>
      </div>

      {/* Overview Stats */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Views</CardTitle>
              <Eye className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{(stats.totalViews || 0).toLocaleString()}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Followers</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{(stats.followerCount || 0).toLocaleString()}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Published Content</CardTitle>
              <FileText className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.contentCount || 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Avg Views/Content</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {stats.contentCount ? Math.round((stats.totalViews || 0) / stats.contentCount) : 0}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Top Content */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Content Performance</CardTitle>
        </CardHeader>
        <CardContent>
          {sorted.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No content yet. Upload your first lesson!</p>
          ) : (
            <div className="space-y-2">
              {sorted.map((item, i) => (
                <div key={item.id} className="flex items-center gap-3 py-2 border-b last:border-0">
                  <span className="text-sm font-medium text-muted-foreground w-6">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{item.title}</p>
                    <div className="flex items-center gap-3 mt-0.5">
                      <Badge variant="outline" className="text-[10px] capitalize py-0 h-5">{item.contentType}</Badge>
                      <span className="text-[10px] text-muted-foreground">{item.viewCount || 0} views</span>
                      <span className="text-[10px] text-muted-foreground">{item.likeCount || 0} likes</span>
                      <span className="text-[10px] text-muted-foreground">{item.doubtCount || 0} doubts</span>
                    </div>
                  </div>
                  <Badge variant={item.isPublished ? "default" : "secondary"} className="text-[10px]">
                    {item.isPublished ? "Live" : "Draft"}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
