import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { contentItems } from "@/db/schema/content";
import { eq } from "drizzle-orm";

/**
 * GET /api/admin/content-preview?id=14
 * Returns the full body of a single content_item for admin preview.
 */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Admin access required" } },
      { status: 403 }
    );
  }

  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json(
      { success: false, error: { code: "MISSING_ID", message: "id parameter required" } },
      { status: 400 }
    );
  }

  const [item] = await db
    .select({
      id: contentItems.id,
      title: contentItems.title,
      body: contentItems.body,
      bodyFormat: contentItems.bodyFormat,
      contentType: contentItems.contentType,
      sourceType: contentItems.sourceType,
    })
    .from(contentItems)
    .where(eq(contentItems.id, parseInt(id, 10)))
    .limit(1);

  if (!item) {
    return NextResponse.json(
      { success: false, error: { code: "NOT_FOUND", message: "Content item not found" } },
      { status: 404 }
    );
  }

  return NextResponse.json({ success: true, data: item });
}
