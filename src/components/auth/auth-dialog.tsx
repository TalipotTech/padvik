"use client";

import { useState } from "react";
import Image from "next/image";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Loader2 } from "lucide-react";

interface AuthDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSwitchToSignUp: () => void;
}

export function AuthDialog({ open, onOpenChange, onSwitchToSignUp }: AuthDialogProps) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });
      if (result?.error) {
        setError("Invalid email or password");
      } else {
        onOpenChange(false);
        router.push("/dashboard");
        router.refresh();
      }
    } catch {
      setError("Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    await signIn("google", { callbackUrl: "/dashboard" });
  }

  async function handleDemo(role: string) {
    setLoading(true);
    setError("");
    try {
      const result = await signIn("demo", {
        role,
        redirect: false,
      });
      if (result?.error) {
        setError("Demo login failed — " + result.error);
      } else {
        onOpenChange(false);
        router.push("/dashboard");
        router.refresh();
      }
    } catch {
      setError("Demo login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mx-auto mb-2">
            <Image src="/logo-icon.png" alt="Padvik" width={48} height={48} priority />
          </div>
          <DialogTitle className="text-center text-xl">Welcome back</DialogTitle>
          <p className="text-center text-sm text-muted-foreground">Sign in to continue learning</p>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {/* Google */}
          <Button variant="outline" className="w-full" onClick={handleGoogle}>
            <GoogleIcon />
            Continue with Google
          </Button>

          <div className="relative">
            <Separator />
            <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-background px-2 text-xs text-muted-foreground">
              or
            </span>
          </div>

          {/* Email form */}
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="signin-email">Email</Label>
              <Input
                id="signin-email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="signin-password">Password</Label>
              <Input
                id="signin-password"
                type="password"
                placeholder="Enter password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="mr-2 size-4 animate-spin" />}
              Sign in
            </Button>
          </form>

          {/* Demo logins — dev, or any env that opts in via
              NEXT_PUBLIC_ENABLE_DEMO_LOGIN (prod MVP test). This is a client
              component, so the gate uses the build-time NEXT_PUBLIC_ flag; the
              server demo provider is gated on ENABLE_DEMO_LOGIN in auth.ts. */}
          {(process.env.NODE_ENV === "development" ||
            process.env.NEXT_PUBLIC_ENABLE_DEMO_LOGIN === "true") && (
            <>
              <div className="relative">
                <Separator />
                <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-background px-2 text-xs text-muted-foreground">
                  demo accounts
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { role: "student", label: "Student", emoji: "🎓" },
                  { role: "teacher", label: "Teacher", emoji: "👩‍🏫" },
                  { role: "admin", label: "Admin", emoji: "⚙️" },
                  { role: "parent", label: "Parent", emoji: "👪" },
                ].map((demo) => (
                  <Button
                    key={demo.role}
                    variant="outline"
                    size="sm"
                    className="h-10 text-sm"
                    onClick={() => handleDemo(demo.role)}
                    disabled={loading}
                  >
                    {demo.emoji} {demo.label}
                  </Button>
                ))}
              </div>
            </>
          )}

          <p className="text-center text-sm text-muted-foreground">
            Don&apos;t have an account?{" "}
            <button onClick={onSwitchToSignUp} className="font-medium text-primary hover:underline">
              Sign up
            </button>
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function GoogleIcon() {
  return (
    <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}
