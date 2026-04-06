import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

/**
 * GET /api/admin/pdf-proxy?url=<encoded-url>
 * Proxies external PDFs through our domain so they can be embedded in iframes.
 * External sites like cbseacademic.nic.in block iframe embedding via X-Frame-Options.
 */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session || session.user.role !== "admin") {
    return new NextResponse("Unauthorized", { status: 403 });
  }

  const url = request.nextUrl.searchParams.get("url");
  if (!url) {
    return new NextResponse("Missing url parameter", { status: 400 });
  }

  // Only allow PDF URLs from known education board domains
  const allowedDomains = [
    "cbseacademic.nic.in",
    "cisce.org",
    "scert.kerala.gov.in",
    "ncert.nic.in",
  ];

  try {
    const parsedUrl = new URL(url);
    if (!allowedDomains.some((d) => parsedUrl.hostname.endsWith(d))) {
      return new NextResponse("Domain not allowed", { status: 403 });
    }
  } catch {
    return new NextResponse("Invalid URL", { status: 400 });
  }

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; PadvikBot/1.0; educational-content)",
      },
    });

    if (!response.ok) {
      return new NextResponse(`Upstream error: ${response.status}`, { status: 502 });
    }

    const buffer = await response.arrayBuffer();

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": "inline",
        "Cache-Control": "public, max-age=86400", // Cache for 24 hours
      },
    });
  } catch (err) {
    return new NextResponse(`Fetch failed: ${err instanceof Error ? err.message : "Unknown"}`, {
      status: 502,
    });
  }
}
