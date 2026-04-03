import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { DashboardHome } from "./_components/dashboard-home";
import type { UserRole } from "@/types/auth";

const DEV_BYPASS = process.env.NODE_ENV === "development";

export default async function DashboardPage() {
  const session = await auth();

  if (!session?.user) {
    if (DEV_BYPASS) {
      return <DashboardHome userName="Dev User" userRole="student" />;
    }
    redirect("/login");
  }

  const role = (session.user as { role?: UserRole }).role ?? "student";

  return (
    <DashboardHome
      userName={session.user.name || session.user.email || "User"}
      userRole={role}
    />
  );
}
