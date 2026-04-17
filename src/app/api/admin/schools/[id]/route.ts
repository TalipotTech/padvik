import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { schools } from "@/db/schema/schools";
import { eq } from "drizzle-orm";

// PUT /api/admin/schools/[id] — Update school + verify/partner/link-creator
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session || (session.user as { role?: string }).role !== "admin") {
    return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Admin required" } }, { status: 403 });
  }

  const { id } = await params;
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ success: false, error: { code: "INVALID_JSON", message: "Invalid JSON" } }, { status: 400 }); }

  const allowedFields = ["name", "address", "city", "district", "state", "pincode", "phone", "email", "website", "principalName", "isVerified", "isPartner", "creatorProfileId"];
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  for (const key of allowedFields) {
    if (body[key] !== undefined) updates[key] = body[key];
  }
  if (body.isPartner === true && !body.partnerSince) updates.partnerSince = new Date();

  const [updated] = await db.update(schools).set(updates).where(eq(schools.id, Number(id))).returning();
  if (!updated) return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "School not found" } }, { status: 404 });
  return NextResponse.json({ success: true, data: updated });
}
