import { NextResponse } from "next/server";

/**
 * Lightweight healthcheck for platform probes (Railway healthcheckPath).
 * Intentionally cheap and dependency-free — must NOT touch the DB, Redis, or
 * any optional external service, so a degraded dependency never fails the
 * deploy. See railway-deploy-playbook.md §4.5.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ success: true, data: { status: "ok" } });
}
