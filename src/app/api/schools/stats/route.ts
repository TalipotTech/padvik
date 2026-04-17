import { NextResponse } from "next/server";
import { db } from "@/db";
import { schools } from "@/db/schema/schools";
import { sql } from "drizzle-orm";

// GET /api/schools/stats — Aggregate stats
export async function GET() {
  const [total] = await db.select({ count: sql<number>`count(*)::int` }).from(schools);
  const byBoard = await db.select({ boardCode: schools.boardCode, count: sql<number>`count(*)::int` }).from(schools).groupBy(schools.boardCode).orderBy(sql`count(*) DESC`).limit(10);
  const byState = await db.select({ state: schools.state, count: sql<number>`count(*)::int` }).from(schools).groupBy(schools.state).orderBy(sql`count(*) DESC`);
  const byManagement = await db.select({ managementType: schools.managementType, count: sql<number>`count(*)::int` }).from(schools).groupBy(schools.managementType).orderBy(sql`count(*) DESC`);
  const [partners] = await db.select({ count: sql<number>`count(*)::int` }).from(schools).where(sql`${schools.isPartner} = true`);

  return NextResponse.json({
    success: true,
    data: {
      totalSchools: total?.count ?? 0,
      partnerCount: partners?.count ?? 0,
      byBoard: byBoard.filter(b => b.boardCode),
      byState: byState.filter(s => s.state),
      byManagement: byManagement.filter(m => m.managementType),
    },
  });
}
