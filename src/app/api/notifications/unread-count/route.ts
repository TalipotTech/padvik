import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { boardNotifications } from "@/db/schema/notifications";
import { users } from "@/db/schema/auth";
import { eq, gt, sql } from "drizzle-orm";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Login required" } },
      { status: 401 }
    );
  }

  try {
    const userId = Number(session.user.id);
    // Demo sessions have IDs like "demo-student" — no user row to look up.
    if (!Number.isFinite(userId)) {
      return NextResponse.json({ success: true, data: { count: 0 } });
    }

    // Get user's last_seen_notifications from preferences
    const [user] = await db
      .select({ preferences: users.preferences })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const prefs = (user?.preferences ?? {}) as Record<string, unknown>;
    const lastSeen = prefs.last_seen_notifications
      ? new Date(prefs.last_seen_notifications as string)
      : new Date(0);

    const [result] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(boardNotifications)
      .where(gt(boardNotifications.createdAt, lastSeen));

    return NextResponse.json({
      success: true,
      data: { count: result?.count ?? 0 },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: { code: "QUERY_ERROR", message } },
      { status: 500 }
    );
  }
}
