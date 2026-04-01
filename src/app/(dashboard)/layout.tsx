import { auth, signOut } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { Toaster } from "@/components/ui/sonner";

const DEV_BYPASS = process.env.NODE_ENV === "development";

const devUser: { name: string | null; email: string | null; image: string | null; role: string } = {
  name: "Dev User",
  email: "dev@padvik.local",
  image: null,
  role: "student",
};

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  let user = devUser;

  if (!DEV_BYPASS) {
    const session = await auth();
    if (!session?.user) redirect("/login");
    user = {
      name: session.user.name ?? null,
      email: session.user.email ?? null,
      image: session.user.image ?? null,
      role: (session.user as { role?: string }).role ?? "student",
    };
  }

  async function handleSignOut() {
    "use server";
    if (DEV_BYPASS) return;
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
    </div>
  );
}
