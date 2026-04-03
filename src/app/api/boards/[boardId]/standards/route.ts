import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { standards } from "@/db/schema/curriculum";
import { and, eq } from "drizzle-orm";

// ---------------------------------------------------------------------------
// GET /api/boards/[boardId]/standards — List grades for a board
// ---------------------------------------------------------------------------
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ boardId: string }> },
) {
  const { boardId: raw } = await params;
  const boardId = parseInt(raw, 10);
  if (isNaN(boardId)) {
    return NextResponse.json(
      { success: false, error: { code: "INVALID_ID", message: "Invalid board ID" } },
      { status: 400 },
    );
  }

  const rows = await db
    .select()
    .from(standards)
    .where(and(eq(standards.boardId, boardId), eq(standards.isActive, true)))
    .orderBy(standards.grade, standards.stream);

  return NextResponse.json({ success: true, data: rows });
}
