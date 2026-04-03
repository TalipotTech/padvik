import Link from "next/link";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";

const adminNav = [
  { href: "/scrape-jobs", label: "Scrape Pipeline" },
  { href: "/curriculum", label: "Curriculum" },
  { href: "/syllabus-viewer", label: "Syllabus Viewer" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session) redirect("/login");
  if (session.user.role !== "admin") redirect("/dashboard");

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/60">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
          <div className="flex items-center gap-4">
            <Link href="/dashboard" className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-violet-600">
                <span className="text-sm font-bold text-white">P</span>
              </div>
              <span className="font-semibold">Padvik Admin</span>
            </Link>

            {/* Nav tabs */}
            <nav className="ml-4 hidden items-center gap-1 sm:flex">
              {adminNav.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/dashboard"
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Dashboard
            </Link>
            <span className="text-sm text-muted-foreground">{session.user.email}</span>
            <span className="rounded-full bg-violet-600/10 px-2 py-0.5 text-xs font-medium text-violet-600">
              admin
            </span>
          </div>
        </div>

        {/* Mobile nav */}
        <div className="flex items-center gap-1 overflow-x-auto border-t px-4 py-1 sm:hidden">
          {adminNav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="shrink-0 rounded-md px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-muted"
            >
              {item.label}
            </Link>
          ))}
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}
