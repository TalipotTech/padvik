import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { uploadToStorage } from "@/lib/s3";

/**
 * POST /api/doubts/upload — Upload a file for use in doubts (image, audio, video, document)
 * Returns the URL that can be used in doubt creation or responses.
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
      return NextResponse.json({ success: false, error: { code: "MISSING_FILE", message: "No file" } }, { status: 400 });
    }

    if (file.size > 25 * 1024 * 1024) {
      return NextResponse.json({ success: false, error: { code: "TOO_LARGE", message: "File must be under 25MB" } }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "bin";
    const key = `doubts/${userId}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const url = await uploadToStorage(key, buffer, file.type);

    // Detect type
    let mediaType = "document";
    if (file.type.startsWith("image/")) mediaType = "image";
    else if (file.type.startsWith("audio/")) mediaType = "audio";
    else if (file.type.startsWith("video/")) mediaType = "video";

    return NextResponse.json({
      success: true,
      data: { url, fileName: file.name, fileSize: file.size, mediaType, mimeType: file.type },
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: { code: "UPLOAD_ERROR", message: err instanceof Error ? err.message : "Failed" } }, { status: 500 });
  }
}
