import { NextResponse } from "next/server";
import { db } from "@/db";
import { boards } from "@/db/schema/curriculum";
import { eq } from "drizzle-orm";

// ---------------------------------------------------------------------------
// GET /api/boards — List all active boards
// ---------------------------------------------------------------------------
export async function GET() {
  const rows = await db
    .select()
    .from(boards)
    .where(eq(boards.isActive, true))
    .orderBy(boards.name);

  return NextResponse.json({ success: true, data: rows });
}
