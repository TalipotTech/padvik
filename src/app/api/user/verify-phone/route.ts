import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { users } from "@/db/schema/auth";
import { eq } from "drizzle-orm";

/**
 * POST /api/user/verify-phone — Send phone verification OTP (DEMO)
 * In production: send OTP via Twilio/MSG91, verify on second call
 * Demo: immediately marks phone as verified
 */
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Login required" } }, { status: 401 });
  }

  const userId = Number(session.user.id);
  const [user] = await db.select({ phone: users.phone, phoneVerified: users.phoneVerified }).from(users).where(eq(users.id, userId)).limit(1);

  if (!user?.phone) {
    return NextResponse.json({ success: false, error: { code: "NO_PHONE", message: "No phone number on file. Add a phone number first." } }, { status: 400 });
  }

  if (user.phoneVerified) {
    return NextResponse.json({ success: true, data: { alreadyVerified: true } });
  }

  // DEMO: In production, send OTP via SMS and verify with second API call
  console.log(`[PHONE-VERIFY-DEMO] Verification for ${user.phone} — auto-approved`);

  await db.update(users).set({ phoneVerified: true, updatedAt: new Date() }).where(eq(users.id, userId));

  return NextResponse.json({ success: true, data: { verified: true, phone: user.phone } });
}
