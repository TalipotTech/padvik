import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { creatorProfiles } from "@/db/schema/creators";
import { eq } from "drizzle-orm";

/**
 * PATCH /api/admin/creators/[id]/featured — Toggle featured status
 * Body: { featured: boolean }
 * Auth: admin only
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session || (session.user as { role?: string }).role !== "admin") {
    return NextResponse.json(
      { success: false, error: { code: "FORBIDDEN", message: "Admin access required" } },
      { status: 403 }
    );
  }

  const { id } = await params;
  const userId = Number(id);

  let body: { featured: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "INVALID_JSON", message: "Invalid JSON body" } },
      { status: 400 }
    );
  }

  if (typeof body.featured !== "boolean") {
    return NextResponse.json(
      { success: false, error: { code: "VALIDATION_ERROR", message: "featured must be a boolean" } },
      { status: 400 }
    );
  }

  const result = await db
    .update(creatorProfiles)
    .set({ isFeatured: body.featured, updatedAt: new Date() })
    .where(eq(creatorProfiles.userId, userId))
    .returning({ isFeatured: creatorProfiles.isFeatured });

  if (result.length === 0) {
    return NextResponse.json(
      { success: false, error: { code: "NOT_FOUND", message: "Creator profile not found" } },
      { status: 404 }
    );
  }

  return NextResponse.json({ success: true, data: { userId, isFeatured: result[0].isFeatured } });
}
