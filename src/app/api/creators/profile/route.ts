import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { users } from "@/db/schema/auth";
import { creatorProfiles } from "@/db/schema/creators";
import { eq } from "drizzle-orm";
import { z } from "zod/v4";

// ---------------------------------------------------------------------------
// GET /api/creators/profile — Get current user's creator profile
// ---------------------------------------------------------------------------
export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Login required" } },
      { status: 401 }
    );
  }

  const userId = Number(session.user.id);

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
      socialLinks: creatorProfiles.socialLinks,
      rating: creatorProfiles.rating,
      followerCount: creatorProfiles.followerCount,
      contentCount: creatorProfiles.contentCount,
      isFeatured: creatorProfiles.isFeatured,
      createdAt: creatorProfiles.createdAt,
      userName: users.fullName,
      userEmail: users.email,
      userAvatar: users.avatarUrl,
      creatorTier: users.creatorTier,
      creatorVerified: users.creatorVerified,
    })
    .from(creatorProfiles)
    .innerJoin(users, eq(users.id, creatorProfiles.userId))
    .where(eq(creatorProfiles.userId, userId))
    .limit(1);

  if (!profile) {
    return NextResponse.json(
      { success: false, error: { code: "NOT_FOUND", message: "Creator profile not found" } },
      { status: 404 }
    );
  }

  return NextResponse.json({ success: true, data: profile });
}

// ---------------------------------------------------------------------------
// PUT /api/creators/profile — Update creator profile
// ---------------------------------------------------------------------------
const updateSchema = z.object({
  displayName: z.string().min(2).max(255).optional(),
  bio: z.string().max(2000).optional(),
  institution: z.string().max(255).optional(),
  institutionType: z.enum(["school", "tuition", "independent", "publisher", "student"]).optional(),
  boards: z.array(z.string()).optional(),
  subjects: z.array(z.string()).optional(),
  classesFrom: z.number().min(1).max(12).optional(),
  classesTo: z.number().min(1).max(12).optional(),
  websiteUrl: z.string().url().optional().nullable(),
  socialLinks: z.record(z.string(), z.string()).optional(),
});

export async function PUT(request: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Login required" } },
      { status: 401 }
    );
  }

  const userId = Number(session.user.id);

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "INVALID_JSON", message: "Invalid JSON body" } },
      { status: 400 }
    );
  }

  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } },
      { status: 400 }
    );
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  for (const [key, value] of Object.entries(parsed.data)) {
    if (value !== undefined) {
      updates[key] = value;
    }
  }

  const [updated] = await db
    .update(creatorProfiles)
    .set(updates)
    .where(eq(creatorProfiles.userId, userId))
    .returning();

  if (!updated) {
    return NextResponse.json(
      { success: false, error: { code: "NOT_FOUND", message: "Creator profile not found" } },
      { status: 404 }
    );
  }

  return NextResponse.json({ success: true, data: updated });
}
