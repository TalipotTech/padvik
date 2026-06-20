/**
 * /auto-content — Admin dashboard for the auto-content generation pipeline.
 *
 * Server Component: fetches the initial payload from GET /api/admin/auto-content
 * (forwarding the admin's cookies) and hands it to the client dashboard, which
 * owns all interactivity. Admin auth is enforced by the (admin) layout.
 */
import Link from "next/link";
import { headers } from "next/headers";
import {
  AutoContentDashboard,
  type DashboardData,
} from "./_components/auto-content-dashboard";

export const dynamic = "force-dynamic";

async function loadDashboard(): Promise<DashboardData | null> {
  const h = await headers();
  const host = h.get("host");
  if (!host) return null;
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const cookie = h.get("cookie") ?? "";

  try {
    const res = await fetch(`${proto}://${host}/api/admin/auto-content`, {
      headers: { cookie },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json?.success ? (json.data as DashboardData) : null;
  } catch {
    return null;
  }
}

export default async function AutoContentPage() {
  const data = await loadDashboard();

  if (!data) {
    return (
      <div className="rounded-lg border border-dashed p-10 text-center">
        <h1 className="text-lg font-semibold">Auto-Content Pipeline</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Could not load dashboard data. Make sure you&apos;re signed in as an admin and the
          API is reachable.
        </p>
        <Link
          href="/help/auto-content"
          className="mt-3 inline-block text-sm font-medium text-violet-600 hover:underline"
        >
          How this feature works →
        </Link>
      </div>
    );
  }

  return <AutoContentDashboard initialData={data} />;
}
