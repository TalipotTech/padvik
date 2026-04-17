import type { Metadata } from "next";
import { Suspense } from "react";
import { DashboardExplore } from "./_components/dashboard-explore";

export const metadata: Metadata = {
  title: "Explore Content | Padvik",
};

export default function DashboardExplorePage() {
  return (
    <Suspense>
      <DashboardExplore />
    </Suspense>
  );
}
