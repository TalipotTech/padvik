import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { z } from "zod/v4";
import { db } from "@/db";
import { users } from "@/db/schema/auth";
import { authConfig } from "./auth.config";
import type { UserRole } from "@/types/auth";

const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(8),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),

    // Email + Password
    Credentials({
      id: "credentials",
      name: "Email & Password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) return null;

        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.email, parsed.data.email))
          .limit(1);

        if (!user || !user.passwordHash) return null;
        if (!user.isActive) return null;

        const valid = await bcrypt.compare(parsed.data.password, user.passwordHash);
        if (!valid) return null;

        return {
          id: String(user.id),
          name: user.fullName,
          email: user.email,
          image: user.avatarUrl,
          role: user.role as UserRole,
          phone: user.phone,
          isCreator: user.isCreator,
        };
      },
    }),

    // Demo login — works without database, for dev/testing only
    Credentials({
      id: "demo",
      name: "Demo Login",
      credentials: {
        role: { label: "Role", type: "text" },
      },
      async authorize(credentials) {
        // Demo login is dev-only by default; allow in other envs (e.g. a prod
        // MVP test deployment) when explicitly opted in via ENABLE_DEMO_LOGIN.
        if (
          process.env.NODE_ENV !== "development" &&
          process.env.ENABLE_DEMO_LOGIN !== "true"
        )
          return null;

        const role = (credentials?.role as string) || "student";
        const demos: Record<string, { name: string; email: string }> = {
          student: { name: "Demo Student", email: "student@demo.padvik.local" },
          teacher: { name: "Demo Teacher", email: "teacher@demo.padvik.local" },
          admin: { name: "Demo Admin", email: "admin@demo.padvik.local" },
          parent: { name: "Demo Parent", email: "parent@demo.padvik.local" },
        };

        const demo = demos[role];
        if (!demo) return null;

        return {
          id: `demo-${role}`,
          name: demo.name,
          email: demo.email,
          image: null,
          role: role as UserRole,
          phone: null,
          isCreator: false,
        };
      },
    }),

    // Phone OTP placeholder
    Credentials({
      id: "phone-otp",
      name: "Phone OTP",
      credentials: {
        phone: { label: "Phone", type: "tel" },
        otp: { label: "OTP", type: "text" },
      },
      async authorize(credentials) {
        const phone = credentials?.phone as string | undefined;
        const otp = credentials?.otp as string | undefined;
        if (!phone || !otp) return null;

        // TODO: Verify OTP against stored code (Redis / MSG91 / Twilio)
        // const storedOtp = await redis.get(`otp:${phone}`);
        // if (!storedOtp || storedOtp !== otp) return null;

        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.phone, phone))
          .limit(1);

        if (!user) return null;
        if (!user.isActive) return null;

        return {
          id: String(user.id),
          name: user.fullName,
          email: user.email,
          image: user.avatarUrl,
          role: user.role as UserRole,
          phone: user.phone,
          isCreator: user.isCreator,
        };
      },
    }),
  ],

  callbacks: {
    ...authConfig.callbacks,
    async signIn({ user, account }) {
      // For Google OAuth: upsert user in database
      if (account?.provider === "google" && user.email) {
        const [existing] = await db
          .select()
          .from(users)
          .where(eq(users.email, user.email))
          .limit(1);

        if (!existing) {
          const [newUser] = await db
            .insert(users)
            .values({
              email: user.email,
              fullName: user.name || "User",
              avatarUrl: user.image,
              role: "student",
              isVerified: true,
              isActive: true,
            })
            .returning({ id: users.id, role: users.role, isCreator: users.isCreator });

          user.id = String(newUser.id);
          user.role = newUser.role as UserRole;
          user.isCreator = newUser.isCreator;
        } else {
          if (!existing.isActive) return false;
          user.id = String(existing.id);
          user.role = existing.role as UserRole;
          user.phone = existing.phone;
          user.isCreator = existing.isCreator;
        }
      }
      return true;
    },
  },
});
