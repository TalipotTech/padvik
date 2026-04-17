import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { schools } from "@/db/schema/schools";
import { eq } from "drizzle-orm";

// GET /api/schools/[id] — Public school detail
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [school] = await db.select().from(schools).where(eq(schools.id, Number(id))).limit(1);
  if (!school) return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "School not found" } }, { status: 404 });
  return NextResponse.json({ success: true, data: school });
}
