import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { DashboardHome } from "./_components/dashboard-home";
import type { UserRole } from "@/types/auth";
import { db } from "@/db";
import { users } from "@/db/schema/auth";
import { eq } from "drizzle-orm";

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
  let isCreator = (session.user as { isCreator?: boolean }).isCreator ?? false;

  // Check DB if JWT is stale
  if (!isCreator && session.user.id) {
    const userId = Number(session.user.id);
    if (!isNaN(userId)) {
      const [dbUser] = await db
        .select({ isCreator: users.isCreator })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      isCreator = dbUser?.isCreator ?? false;
    }
  }

  // Creators go straight to the creator dashboard
  if (isCreator) {
    redirect("/dashboard/creator");
  }

  return (
    <DashboardHome
      userName={session.user.name || session.user.email || "User"}
      userRole={role}
    />
  );
}
