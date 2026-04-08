import { auth, signOut } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { Toaster } from "@/components/ui/sonner";
import { FloatingChatWidget } from "@/components/chat/floating-chat-widget";

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

  let user: { name: string | null; email: string | null; image: string | null; role: string };

  if (session?.user) {
    user = {
      name: session.user.name ?? null,
      email: session.user.email ?? null,
      image: session.user.image ?? null,
      role: (session.user as { role?: string }).role ?? "student",
    };
  } else if (DEV_BYPASS) {
    // Fall back to dev user only in development when no session exists
    user = devUser;
  } else {
    redirect("/login");
  }

  async function handleSignOut() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
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
