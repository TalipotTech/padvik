import Link from "next/link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-br from-violet-50 via-background to-violet-50/50">
      {/* Header */}
      <header className="border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-600">
              <span className="text-sm font-bold text-white">P</span>
            </div>
            <span className="text-lg font-bold">Padvik</span>
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/" className="text-muted-foreground hover:text-foreground">
              Home
            </Link>
            <Link href="/login" className="text-muted-foreground hover:text-foreground">
              Sign In
            </Link>
            <Link href="/register" className="text-muted-foreground hover:text-foreground">
              Sign Up
            </Link>
          </nav>
        </div>
      </header>

      {/* Content */}
      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">{children}</div>
      </div>

      {/* Footer */}
      <footer className="border-t bg-background/80">
        <div className="mx-auto flex h-12 max-w-7xl items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded bg-violet-600">
              <span className="text-[10px] font-bold text-white">P</span>
            </div>
            <span className="text-xs text-muted-foreground">
              Padvik by Ensate Technologies
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            &copy; {new Date().getFullYear()} Ensate Technologies. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
