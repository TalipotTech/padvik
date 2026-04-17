import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { ExploreContent } from "./_components/explore-content";

export const metadata: Metadata = {
  title: "Explore Content | Padvik",
  description: "Browse educational content from verified creators across CBSE, ICSE, Kerala SCERT and all major Indian state boards.",
};

export default async function ExplorePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Logged-in users should see the explore page inside the dashboard layout (with sidebar)
  const session = await auth();
  if (session?.user) {
    const params = new URLSearchParams();
    const sp = await searchParams;
    for (const [k, v] of Object.entries(sp)) {
      if (typeof v === "string") params.set(k, v);
    }
    const qs = params.toString();
    redirect(`/dashboard/explore${qs ? `?${qs}` : ""}`);
  }

  return (
    <Suspense>
      <ExploreContent />
    </Suspense>
  );
}
