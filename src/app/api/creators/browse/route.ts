import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema/auth";
import { creatorProfiles } from "@/db/schema/creators";
import { eq, ilike, sql, and } from "drizzle-orm";
import { z } from "zod/v4";

const querySchema = z.object({
  search: z.string().optional(),
  institutionType: z.string().optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(50).default(20),
});

// ---------------------------------------------------------------------------
// GET /api/creators/browse — Public paginated creator listing
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest) {
  const params = Object.fromEntries(request.nextUrl.searchParams);
  const parsed = querySchema.safeParse(params);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } },
      { status: 400 }
    );
  }

  const { search, institutionType, page, limit } = parsed.data;
  const offset = (page - 1) * limit;

  const conditions = [];

  if (search) {
    conditions.push(ilike(creatorProfiles.displayName, `%${search}%`));
  }
  if (institutionType) {
    conditions.push(eq(creatorProfiles.institutionType, institutionType));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [creators, countResult] = await Promise.all([
    db
      .select({
        id: creatorProfiles.id,
        userId: creatorProfiles.userId,
        displayName: creatorProfiles.displayName,
        bio: creatorProfiles.bio,
        institution: creatorProfiles.institution,
        institutionType: creatorProfiles.institutionType,
        boards: creatorProfiles.boards,
        subjects: creatorProfiles.subjects,
        rating: creatorProfiles.rating,
        followerCount: creatorProfiles.followerCount,
        contentCount: creatorProfiles.contentCount,
        isFeatured: creatorProfiles.isFeatured,
        userName: users.fullName,
        userAvatar: users.avatarUrl,
        creatorVerified: users.creatorVerified,
      })
      .from(creatorProfiles)
      .innerJoin(users, eq(users.id, creatorProfiles.userId))
      .where(whereClause)
      .orderBy(creatorProfiles.isFeatured, creatorProfiles.followerCount)
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(creatorProfiles)
      .where(whereClause),
  ]);

  const total = countResult[0]?.count ?? 0;

  return NextResponse.json({
    success: true,
    data: {
      items: creators,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    },
  });
}
