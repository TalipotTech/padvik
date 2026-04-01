"use server";

import { signIn } from "@/lib/auth";
import { db } from "@/db";
import { users } from "@/db/schema/auth";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { z } from "zod/v4";
import { redirect } from "next/navigation";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------
const registerSchema = z.object({
  fullName: z.string().min(2, "Name must be at least 2 characters"),
  email: z.email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  role: z.enum(["student", "teacher", "parent"]),
});

const loginSchema = z.object({
  email: z.email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type AuthState = {
  error?: string;
  success?: boolean;
};

// ---------------------------------------------------------------------------
// Register
// ---------------------------------------------------------------------------
export async function registerAction(
  _prevState: AuthState,
  formData: FormData
): Promise<AuthState> {
  const raw = {
    fullName: formData.get("fullName") as string,
    email: formData.get("email") as string,
    password: formData.get("password") as string,
    role: formData.get("role") as string,
  };

  const parsed = registerSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const { fullName, email, password, role } = parsed.data;

  // Check if email already exists
  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing) {
    return { error: "An account with this email already exists" };
  }

  // Hash password and create user
  const passwordHash = await bcrypt.hash(password, 12);
  await db.insert(users).values({
    fullName,
    email,
    passwordHash,
    role,
    isActive: true,
    isVerified: false,
  });

  // Auto sign-in after registration
  try {
    await signIn("credentials", {
      email,
      password,
      redirect: false,
    });
  } catch {
    // Sign-in failed, but registration succeeded — redirect to login
    redirect("/login?registered=true");
  }

  redirect("/dashboard");
}

// ---------------------------------------------------------------------------
// Login with Credentials
// ---------------------------------------------------------------------------
export async function loginAction(
  _prevState: AuthState,
  formData: FormData
): Promise<AuthState> {
  const raw = {
    email: formData.get("email") as string,
    password: formData.get("password") as string,
  };

  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  try {
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirect: false,
    });
  } catch {
    return { error: "Invalid email or password" };
  }

  redirect("/dashboard");
}

// ---------------------------------------------------------------------------
// Login with Google (client-side redirect)
// ---------------------------------------------------------------------------
export async function googleSignIn() {
  await signIn("google", { redirectTo: "/dashboard" });
}

// ---------------------------------------------------------------------------
// Phone OTP — Request OTP (placeholder)
// ---------------------------------------------------------------------------
export async function requestOtp(
  _prevState: AuthState,
  formData: FormData
): Promise<AuthState> {
  const phone = formData.get("phone") as string;
  if (!phone || phone.length < 10) {
    return { error: "Enter a valid phone number" };
  }

  // TODO: Implement actual OTP sending via MSG91/Twilio
  // await sendOtp(phone);
  // await redis.set(`otp:${phone}`, generatedOtp, "EX", 300);

  return { success: true };
}

// ---------------------------------------------------------------------------
// Phone OTP — Verify & Sign In (placeholder)
// ---------------------------------------------------------------------------
export async function verifyOtpAction(
  _prevState: AuthState,
  formData: FormData
): Promise<AuthState> {
  const phone = formData.get("phone") as string;
  const otp = formData.get("otp") as string;

  if (!phone || !otp) {
    return { error: "Phone and OTP are required" };
  }

  try {
    await signIn("phone-otp", {
      phone,
      otp,
      redirect: false,
    });
  } catch {
    return { error: "Invalid OTP or phone number not registered" };
  }

  redirect("/dashboard");
}

// ---------------------------------------------------------------------------
// Demo Login (development only)
// ---------------------------------------------------------------------------
export async function demoSignIn(role: string) {
  await signIn("demo", { role, redirectTo: "/dashboard" });
}
