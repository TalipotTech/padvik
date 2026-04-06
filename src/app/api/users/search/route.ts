import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { users } from "@/db/schema/auth";
import { ilike, or, eq, and, ne } from "drizzle-orm";

// ---------------------------------------------------------------------------
// GET /api/users/search?q=... — Search users for sharing UI
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Login required" } },
      { status: 401 }
    );
  }

  const query = request.nextUrl.searchParams.get("q");
  if (!query || query.length < 2) {
    return NextResponse.json(
      { success: false, error: { code: "QUERY_TOO_SHORT", message: "Search query must be at least 2 characters" } },
      { status: 400 }
    );
  }

  const userId = Number(session.user.id);
  const searchPattern = `%${query}%`;

  const results = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      email: users.email,
      role: users.role,
      avatarUrl: users.avatarUrl,
    })
    .from(users)
    .where(
      and(
        ne(users.id, userId), // Exclude self
        eq(users.isActive, true),
        or(
          ilike(users.fullName, searchPattern),
          ilike(users.email, searchPattern)
        )
      )
    )
    .limit(20);

  return NextResponse.json({
    success: true,
    data: results,
  });
}
