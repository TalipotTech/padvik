import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { questionPapers } from "@/db/schema/questions";
import { desc } from "drizzle-orm";

// ---------------------------------------------------------------------------
// GET /api/admin/question-papers — List all question papers
// ---------------------------------------------------------------------------
export async function GET() {
  const session = await auth();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Admin access required" } },
      { status: 403 }
    );
  }

  const papers = await db
    .select()
    .from(questionPapers)
    .orderBy(desc(questionPapers.createdAt))
    .limit(100);

  return NextResponse.json({ success: true, data: papers });
}
