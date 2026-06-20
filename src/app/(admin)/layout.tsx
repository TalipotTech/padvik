import Link from "next/link";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { PadvikLogo } from "@/components/ui/padvik-logo";
import { primaryNav, legacyNav, helpNav } from "./_nav";
import { AdminHelpMenu } from "./_components/admin-help-menu";

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
              <PadvikLogo size="md" showText={false} />
              <span className="font-semibold">Padvik Admin</span>
            </Link>

            {/* Nav — primary links, then a separator, then legacy */}
            <nav className="ml-4 hidden items-center gap-1 sm:flex">
              {primaryNav.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  {item.label}
                </Link>
              ))}
              <span
                className="mx-2 hidden h-4 w-px bg-border lg:inline-block"
                aria-hidden
              />
              <span className="hidden text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 lg:inline">
                Legacy
              </span>
              {legacyNav.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground"
                  title="Legacy pipeline UI — prefer /admin/coverage"
                >
                  {item.label}
                </Link>
              ))}
              <span
                className="mx-2 hidden h-4 w-px bg-border lg:inline-block"
                aria-hidden
              />
              <AdminHelpMenu />
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

        {/* Mobile nav — same split, thinner styling */}
        <div className="flex items-center gap-1 overflow-x-auto border-t px-4 py-1 sm:hidden">
          {primaryNav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="shrink-0 rounded-md px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-muted"
            >
              {item.label}
            </Link>
          ))}
          <span className="mx-1 h-3 w-px shrink-0 bg-border" aria-hidden />
          {legacyNav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="shrink-0 rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground/70 hover:bg-muted"
              title="Legacy"
            >
              {item.label}
            </Link>
          ))}
          <span className="mx-1 h-3 w-px shrink-0 bg-border" aria-hidden />
          {helpNav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="shrink-0 rounded-md px-2 py-1 text-[11px] font-medium text-violet-600 hover:bg-muted"
            >
              {item.label === "Help Home" ? "Help" : item.label}
            </Link>
          ))}
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}
