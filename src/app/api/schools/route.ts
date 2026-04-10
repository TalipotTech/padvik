import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { schools } from "@/db/schema/schools";
import { eq, and, ilike, desc, sql } from "drizzle-orm";
import { z } from "zod/v4";

const querySchema = z.object({
  q: z.string().optional(),
  state: z.string().optional(),
  district: z.string().optional(),
  boardCode: z.string().optional(),
  managementType: z.string().optional(),
  classesTo: z.coerce.number().optional(),
  isPartner: z.enum(["true", "false"]).optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
});

// GET /api/schools — Public search & browse
export async function GET(request: NextRequest) {
  const params = Object.fromEntries(request.nextUrl.searchParams);
  const parsed = querySchema.safeParse(params);
  if (!parsed.success) return NextResponse.json({ success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } }, { status: 400 });

  const { q, state, district, boardCode, managementType, classesTo, isPartner, limit, offset } = parsed.data;

  // Build WHERE conditions
  const conditions = [];
  if (state) conditions.push(ilike(schools.state, state));
  if (district) conditions.push(ilike(schools.district, `%${district}%`));
  if (boardCode) conditions.push(eq(schools.boardCode, boardCode.toUpperCase()));
  if (managementType) conditions.push(eq(schools.managementType, managementType));
  if (classesTo) conditions.push(sql`${schools.classesTo} >= ${classesTo}`);
  if (isPartner === "true") conditions.push(eq(schools.isPartner, true));

  // Fuzzy name search with pg_trgm
  if (q && q.length >= 2) {
    conditions.push(sql`similarity(${schools.name}, ${q}) > 0.15`);
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  const orderBy = q ? sql`similarity(${schools.name}, ${q}) DESC` : desc(schools.updatedAt);

  const [items, countResult] = await Promise.all([
    db.select({
      id: schools.id, name: schools.name, slug: schools.slug,
      boardCode: schools.boardCode, district: schools.district, state: schools.state,
      city: schools.city, managementType: schools.managementType,
      classesFrom: schools.classesFrom, classesTo: schools.classesTo,
      studentCount: schools.studentCount, isPartner: schools.isPartner, isVerified: schools.isVerified,
    }).from(schools).where(whereClause).orderBy(orderBy).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)::int` }).from(schools).where(whereClause),
  ]);

  return NextResponse.json({
    success: true,
    data: {
      items,
      pagination: { limit, offset, total: countResult[0]?.count ?? 0 },
    },
  });
}
