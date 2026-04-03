"use client";

import { useState } from "react";
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
    const demoEmails: Record<string, string> = {
      student: "student@padvik.in",
      teacher: "teacher@padvik.in",
      admin: "admin@padvik.in",
      parent: "parent@padvik.in",
    };
    try {
      const result = await signIn("credentials", {
        email: demoEmails[role],
        password: "demo1234",
        redirect: false,
      });
      if (!result?.error) {
        onOpenChange(false);
        router.push("/dashboard");
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
          <DialogTitle className="text-center text-xl">Sign in to Padvik</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {/* Google */}
          <Button variant="outline" className="w-full" onClick={handleGoogle}>
            <svg className="mr-2 size-4" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
            </svg>
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
              <Label htmlFor="signin-email" className="text-xs">Email</Label>
              <Input
                id="signin-email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="signin-password" className="text-xs">Password</Label>
              <Input
                id="signin-password"
                type="password"
                placeholder="Enter password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="mr-2 size-4 animate-spin" />}
              Sign In
            </Button>
          </form>

          {/* Demo logins */}
          {process.env.NODE_ENV === "development" && (
            <>
              <Separator />
              <div className="space-y-1.5">
                <p className="text-center text-xs text-muted-foreground">Quick demo login</p>
                <div className="grid grid-cols-4 gap-2">
                  {["student", "teacher", "admin", "parent"].map((role) => (
                    <Button
                      key={role}
                      variant="outline"
                      size="sm"
                      className="text-xs capitalize"
                      onClick={() => handleDemo(role)}
                      disabled={loading}
                    >
                      {role}
                    </Button>
                  ))}
                </div>
              </div>
            </>
          )}

          <p className="text-center text-xs text-muted-foreground">
            Don&apos;t have an account?{" "}
            <button onClick={onSwitchToSignUp} className="font-medium text-violet-600 hover:underline">
              Sign up
            </button>
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
