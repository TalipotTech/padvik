import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { eq } from "drizzle-orm";
import { subjects } from "@/db/schema/curriculum";
import { z } from "zod/v4";

const reviewSchema = z.object({
  action: z.enum(["approve", "reject", "flag"]),
  notes: z.string().optional(),
});

/**
 * POST /api/admin/curriculum-explorer/[subjectId]/review
 *
 * Approve, reject, or flag a parsed subject for accuracy.
 * Updates the reviewStatus in the subject's metadata.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ subjectId: string }> }
) {
  const session = await auth();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Admin access required" } },
      { status: 403 }
    );
  }

  const { subjectId: subjectIdStr } = await params;
  const subjectId = parseInt(subjectIdStr, 10);
  if (isNaN(subjectId)) {
    return NextResponse.json(
      { success: false, error: { code: "INVALID_ID", message: "Invalid subject ID" } },
      { status: 400 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "INVALID_JSON", message: "Invalid JSON body" } },
      { status: 400 }
    );
  }

  const parsed = reviewSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } },
      { status: 400 }
    );
  }

  const { action, notes } = parsed.data;

  try {
    const [subject] = await db
      .select({ id: subjects.id, metadata: subjects.metadata })
      .from(subjects)
      .where(eq(subjects.id, subjectId))
      .limit(1);

    if (!subject) {
      return NextResponse.json(
        { success: false, error: { code: "NOT_FOUND", message: "Subject not found" } },
        { status: 404 }
      );
    }

    const statusMap: Record<string, string> = {
      approve: "approved",
      reject: "rejected",
      flag: "flagged",
    };

    const existingMeta = (subject.metadata as Record<string, unknown>) ?? {};
    const updatedMeta = {
      ...existingMeta,
      reviewStatus: statusMap[action],
      reviewedBy: session.user.email ?? session.user.id,
      reviewedAt: new Date().toISOString(),
      reviewNotes: notes ?? null,
    };

    await db
      .update(subjects)
      .set({ metadata: updatedMeta })
      .where(eq(subjects.id, subjectId));

    return NextResponse.json({
      success: true,
      data: { subjectId, reviewStatus: statusMap[action] },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: { code: "UPDATE_ERROR", message } },
      { status: 500 }
    );
  }
}
