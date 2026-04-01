"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  loginAction,
  googleSignIn,
  requestOtp,
  verifyOtpAction,
  demoSignIn,
  type AuthState,
} from "../_actions/auth";

type Tab = "email" | "phone";

export default function LoginPage() {
  const [tab, setTab] = useState<Tab>("email");
  const [otpSent, setOtpSent] = useState(false);
  const [phone, setPhone] = useState("");

  const [loginState, loginFormAction, loginPending] = useActionState<AuthState, FormData>(
    loginAction,
    {}
  );
  const [otpRequestState, otpRequestAction, otpRequestPending] = useActionState<
    AuthState,
    FormData
  >(async (_prev, formData) => {
    const result = await requestOtp({}, formData);
    if (result.success) setOtpSent(true);
    return result;
  }, {});
  const [otpVerifyState, otpVerifyAction, otpVerifyPending] = useActionState<AuthState, FormData>(
    verifyOtpAction,
    {}
  );

  return (
    <Card>
      <CardHeader className="text-center">
        <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary">
          <span className="text-xl font-bold text-primary-foreground">P</span>
        </div>
        <CardTitle>Welcome back</CardTitle>
        <CardDescription>Sign in to continue learning</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Google OAuth */}
        <form action={googleSignIn}>
          <Button type="submit" variant="outline" className="w-full">
            <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
              <path
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                fill="#4285F4"
              />
              <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                fill="#34A853"
              />
              <path
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                fill="#FBBC05"
              />
              <path
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                fill="#EA4335"
              />
            </svg>
            Continue with Google
          </Button>
        </form>

        <div className="relative">
          <Separator />
          <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-card px-2 text-xs text-muted-foreground">
            or
          </span>
        </div>

        {/* Tab switcher */}
        <div className="flex rounded-md border">
          <button
            type="button"
            onClick={() => {
              setTab("email");
              setOtpSent(false);
            }}
            className={`flex-1 rounded-l-md px-3 py-2 text-sm font-medium transition-colors ${
              tab === "email"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Email
          </button>
          <button
            type="button"
            onClick={() => setTab("phone")}
            className={`flex-1 rounded-r-md px-3 py-2 text-sm font-medium transition-colors ${
              tab === "phone"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Phone
          </button>
        </div>

        {/* Email/Password form */}
        {tab === "email" && (
          <form action={loginFormAction} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                placeholder="you@example.com"
                required
                autoComplete="email"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                placeholder="••••••••"
                required
                autoComplete="current-password"
              />
            </div>
            {loginState.error && (
              <p className="text-sm text-destructive">{loginState.error}</p>
            )}
            <Button type="submit" className="w-full" disabled={loginPending}>
              {loginPending ? "Signing in..." : "Sign in"}
            </Button>
          </form>
        )}

        {/* Phone OTP form */}
        {tab === "phone" && !otpSent && (
          <form action={otpRequestAction} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="phone">Phone Number</Label>
              <Input
                id="phone"
                name="phone"
                type="tel"
                placeholder="+91 98765 43210"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
            {otpRequestState.error && (
              <p className="text-sm text-destructive">{otpRequestState.error}</p>
            )}
            <Button type="submit" className="w-full" disabled={otpRequestPending}>
              {otpRequestPending ? "Sending OTP..." : "Send OTP"}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Phone login coming soon — use email or Google for now
            </p>
          </form>
        )}

        {tab === "phone" && otpSent && (
          <form action={otpVerifyAction} className="space-y-4">
            <input type="hidden" name="phone" value={phone} />
            <div className="space-y-2">
              <Label htmlFor="otp">Enter OTP sent to {phone}</Label>
              <Input
                id="otp"
                name="otp"
                type="text"
                placeholder="6-digit OTP"
                required
                maxLength={6}
                autoComplete="one-time-code"
              />
            </div>
            {otpVerifyState.error && (
              <p className="text-sm text-destructive">{otpVerifyState.error}</p>
            )}
            <Button type="submit" className="w-full" disabled={otpVerifyPending}>
              {otpVerifyPending ? "Verifying..." : "Verify & Sign in"}
            </Button>
            <button
              type="button"
              onClick={() => setOtpSent(false)}
              className="w-full text-center text-sm text-muted-foreground hover:text-foreground"
            >
              Change phone number
            </button>
          </form>
        )}
      </CardContent>

      {/* Demo logins — dev only */}
      {process.env.NODE_ENV === "development" && (
        <>
          <div className="px-6">
            <div className="relative">
              <Separator />
              <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-card px-2 text-xs text-muted-foreground">
                demo accounts
              </span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 px-6 py-4">
            {(
              [
                { role: "student", label: "Student", emoji: "🎓" },
                { role: "teacher", label: "Teacher", emoji: "👩‍🏫" },
                { role: "admin", label: "Admin", emoji: "⚙️" },
                { role: "parent", label: "Parent", emoji: "👪" },
              ] as const
            ).map((demo) => (
              <form key={demo.role} action={() => demoSignIn(demo.role)}>
                <Button
                  type="submit"
                  variant="outline"
                  className="w-full text-sm h-10"
                  size="sm"
                >
                  {demo.emoji} {demo.label}
                </Button>
              </form>
            ))}
          </div>
        </>
      )}

      <CardFooter className="justify-center">
        <p className="text-sm text-muted-foreground">
          Don&apos;t have an account?{" "}
          <a href="/register" className="font-medium text-primary hover:underline">
            Sign up
          </a>
        </p>
      </CardFooter>
    </Card>
  );
}
