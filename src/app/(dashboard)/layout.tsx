import { auth, signOut } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { Toaster } from "@/components/ui/sonner";
import { FloatingChatWidget } from "@/components/chat/floating-chat-widget";
import { UserSessionSync } from "@/components/layout/user-session-sync";
import { db } from "@/db";
import { users } from "@/db/schema/auth";
import { creatorProfiles } from "@/db/schema/creators";
import { eq } from "drizzle-orm";

const DEV_BYPASS = process.env.NODE_ENV === "development";

const devUser: { name: string | null; email: string | null; image: string | null; role: string } = {
  name: "Dev User",
  email: "dev@padvik.local",
  image: null,
  role: "admin",
};

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // Always try to get the real session first
  const session = await auth();

  let user: { name: string | null; email: string | null; image: string | null; role: string; isCreator?: boolean; creatorDisplayName?: string | null };

  if (session?.user) {
    let isCreator = (session.user as { isCreator?: boolean }).isCreator ?? false;
    let creatorDisplayName: string | null = null;

    const userId = Number(session.user.id);

    // If JWT says not a creator, double-check DB (JWT may be stale after registration)
    if (!isCreator && !isNaN(userId)) {
      const [dbUser] = await db
        .select({ isCreator: users.isCreator })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      isCreator = dbUser?.isCreator ?? false;
    }

    // Fetch creator display name for the header
    if (isCreator && !isNaN(userId)) {
      const [profile] = await db
        .select({ displayName: creatorProfiles.displayName })
        .from(creatorProfiles)
        .where(eq(creatorProfiles.userId, userId))
        .limit(1);
      creatorDisplayName = profile?.displayName ?? null;
    }

    user = {
      name: session.user.name ?? null,
      email: session.user.email ?? null,
      image: session.user.image ?? null,
      role: (session.user as { role?: string }).role ?? "student",
      isCreator,
      creatorDisplayName,
    };
  } else if (DEV_BYPASS) {
    // Fall back to dev user only in development when no session exists
    user = { ...devUser, isCreator: false };
  } else {
    redirect("/login");
  }

  async function handleSignOut() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  // Get the userId for session sync (clear stale localStorage from previous user)
  const sessionUserId = session?.user?.id || "dev";

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <UserSessionSync userId={sessionUserId} />
      <Sidebar user={user} signOutAction={handleSignOut} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header user={user} signOutAction={handleSignOut} />
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-7xl px-4 py-4 lg:px-6 lg:py-6">
            <Breadcrumbs />
            {children}
          </div>
        </main>
      </div>
      <Toaster />
      <FloatingChatWidget />
    </div>
  );
}
