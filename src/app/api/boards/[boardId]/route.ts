import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { boards } from "@/db/schema/curriculum";
import { eq } from "drizzle-orm";

// ---------------------------------------------------------------------------
// GET /api/boards/[boardId] — Single board details
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

  const [row] = await db.select().from(boards).where(eq(boards.id, boardId)).limit(1);

  if (!row) {
    return NextResponse.json(
      { success: false, error: { code: "NOT_FOUND", message: "Board not found" } },
      { status: 404 },
    );
  }

  return NextResponse.json({ success: true, data: row });
}
