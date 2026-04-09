import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { users } from "@/db/schema/auth";
import { eq, sql } from "drizzle-orm";

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Login required" } },
      { status: 401 }
    );
  }

  try {
    const userId = Number(session.user.id);

    await db
      .update(users)
      .set({
        preferences: sql`COALESCE(${users.preferences}, '{}'::jsonb) || ${JSON.stringify({ last_seen_notifications: new Date().toISOString() })}::jsonb`,
      })
      .where(eq(users.id, userId));

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: { code: "UPDATE_ERROR", message } },
      { status: 500 }
    );
  }
}
