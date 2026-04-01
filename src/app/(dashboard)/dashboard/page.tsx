import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { DashboardHome } from "./_components/dashboard-home";

const DEV_BYPASS = process.env.NODE_ENV === "development";

export default async function DashboardPage() {
  if (DEV_BYPASS) {
    return <DashboardHome userName="Dev User" />;
  }

  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <DashboardHome
      userName={session.user.name || session.user.email || "Student"}
    />
  );
}
