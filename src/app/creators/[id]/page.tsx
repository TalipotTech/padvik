import { notFound } from "next/navigation";
import { db } from "@/db";
import { users } from "@/db/schema/auth";
import { creatorProfiles, creatorContent } from "@/db/schema/creators";
import { eq, and, desc } from "drizzle-orm";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Users, FolderOpen, Star } from "lucide-react";
import Link from "next/link";

export default async function PublicCreatorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const creatorId = Number(id);
  if (isNaN(creatorId)) notFound();

  const [profile] = await db
    .select({
      id: creatorProfiles.id,
      userId: creatorProfiles.userId,
      displayName: creatorProfiles.displayName,
      bio: creatorProfiles.bio,
      institution: creatorProfiles.institution,
      institutionType: creatorProfiles.institutionType,
      boards: creatorProfiles.boards,
      subjects: creatorProfiles.subjects,
      classesFrom: creatorProfiles.classesFrom,
      classesTo: creatorProfiles.classesTo,
      websiteUrl: creatorProfiles.websiteUrl,
      rating: creatorProfiles.rating,
      followerCount: creatorProfiles.followerCount,
      contentCount: creatorProfiles.contentCount,
      createdAt: creatorProfiles.createdAt,
      userName: users.fullName,
      userAvatar: users.avatarUrl,
      creatorVerified: users.creatorVerified,
    })
    .from(creatorProfiles)
    .innerJoin(users, eq(users.id, creatorProfiles.userId))
    .where(eq(creatorProfiles.userId, creatorId))
    .limit(1);

  if (!profile) notFound();

  // Get published content
  const publishedContent = await db
    .select({
      id: creatorContent.id,
      title: creatorContent.title,
      contentType: creatorContent.contentType,
      description: creatorContent.description,
      viewCount: creatorContent.viewCount,
      likeCount: creatorContent.likeCount,
      publishedAt: creatorContent.publishedAt,
    })
    .from(creatorContent)
    .where(
      and(
        eq(creatorContent.creatorId, creatorId),
        eq(creatorContent.isPublished, true)
      )
    )
    .orderBy(desc(creatorContent.publishedAt))
    .limit(20);

  const initials = profile.displayName
    .split(" ")
    .map((n: string) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-4xl px-4 py-8 space-y-8">
        {/* Profile Header */}
        <div className="flex items-start gap-6">
          <Avatar className="h-20 w-20 shrink-0">
            <AvatarImage src={profile.userAvatar || undefined} />
            <AvatarFallback className="text-2xl bg-primary/10 text-primary">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h1 className="text-3xl font-bold">{profile.displayName}</h1>
              {profile.creatorVerified && <Badge variant="default">Verified</Badge>}
            </div>
            {profile.institution && (
              <p className="text-muted-foreground mt-1">
                {profile.institution}
                {profile.institutionType && ` · ${profile.institutionType}`}
              </p>
            )}
            {profile.bio && <p className="mt-3 text-sm">{profile.bio}</p>}

            <div className="flex items-center gap-6 mt-4">
              <div className="flex items-center gap-1.5 text-sm">
                <Users className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">{profile.followerCount}</span>
                <span className="text-muted-foreground">followers</span>
              </div>
              <div className="flex items-center gap-1.5 text-sm">
                <FolderOpen className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">{publishedContent.length}</span>
                <span className="text-muted-foreground">published</span>
              </div>
              {Number(profile.rating) > 0 && (
                <div className="flex items-center gap-1.5 text-sm">
                  <Star className="h-4 w-4 text-yellow-500" />
                  <span className="font-medium">{profile.rating}</span>
                </div>
              )}
            </div>

            {profile.classesFrom && profile.classesTo && (
              <p className="text-sm text-muted-foreground mt-2">
                Classes {profile.classesFrom}–{profile.classesTo}
              </p>
            )}

            {profile.websiteUrl && (
              <a
                href={profile.websiteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-primary hover:underline mt-1 inline-block"
              >
                {profile.websiteUrl}
              </a>
            )}
          </div>
        </div>

        {/* Published Content */}
        <div>
          <h2 className="text-xl font-bold mb-4">Published Content</h2>
          {publishedContent.length === 0 ? (
            <p className="text-muted-foreground">No published content yet.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {publishedContent.map((item) => (
                <Card key={item.id}>
                  <CardContent className="py-4">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="outline" className="capitalize text-xs">
                        {item.contentType}
                      </Badge>
                    </div>
                    <h3 className="font-medium line-clamp-2">{item.title}</h3>
                    {item.description && (
                      <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
                        {item.description}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground mt-2">
                      {item.viewCount} views · {item.likeCount} likes
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
