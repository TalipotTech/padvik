import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { users } from "@/db/schema/auth";
import { eq } from "drizzle-orm";
import { uploadToStorage, generateStorageKey } from "@/lib/s3";

/**
 * POST /api/user/avatar — Upload profile photo
 * Accepts multipart form with "file" field (image only, max 5MB)
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Login required" } }, { status: 401 });
  }
  const userId = Number(session.user.id);

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ success: false, error: { code: "MISSING_FILE", message: "No file provided" } }, { status: 400 });
    }

    // Validate image
    const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!allowed.includes(file.type)) {
      return NextResponse.json({ success: false, error: { code: "INVALID_TYPE", message: "Only JPEG, PNG, WEBP, GIF images allowed" } }, { status: 400 });
    }
    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json({ success: false, error: { code: "TOO_LARGE", message: "Image must be under 5MB" } }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
    const storageKey = `avatars/${userId}/avatar-${Date.now()}.${ext}`;
    const avatarUrl = await uploadToStorage(storageKey, buffer, file.type);

    // Update user record
    await db.update(users).set({ avatarUrl, updatedAt: new Date() }).where(eq(users.id, userId));

    return NextResponse.json({ success: true, data: { avatarUrl } });
  } catch (err) {
    return NextResponse.json({ success: false, error: { code: "UPLOAD_ERROR", message: err instanceof Error ? err.message : "Upload failed" } }, { status: 500 });
  }
}
