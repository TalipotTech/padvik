import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { users } from "@/db/schema/auth";
import { eq } from "drizzle-orm";

/**
 * POST /api/user/verify-email — Send verification email (DEMO)
 * In production: send OTP/link via SendGrid/SES, verify on callback
 * Demo: immediately marks email as verified
 */
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Login required" } }, { status: 401 });
  }

  const userId = Number(session.user.id);
  const [user] = await db.select({ email: users.email, emailVerified: users.emailVerified }).from(users).where(eq(users.id, userId)).limit(1);

  if (!user?.email) {
    return NextResponse.json({ success: false, error: { code: "NO_EMAIL", message: "No email address on file" } }, { status: 400 });
  }

  if (user.emailVerified) {
    return NextResponse.json({ success: true, data: { alreadyVerified: true } });
  }

  // DEMO: In production, send an OTP email and verify on callback
  // For now, mark as verified immediately
  console.log(`[EMAIL-VERIFY-DEMO] Verification for ${user.email} — auto-approved`);

  await db.update(users).set({ emailVerified: true, updatedAt: new Date() }).where(eq(users.id, userId));

  return NextResponse.json({ success: true, data: { verified: true, email: user.email } });
}
