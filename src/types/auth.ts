import type { DefaultSession } from "next-auth";

export type UserRole = "student" | "teacher" | "admin" | "parent";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: UserRole;
      phone?: string | null;
    } & DefaultSession["user"];
  }

  interface User {
    role: UserRole;
    phone?: string | null;
  }

  // JWT interface is part of the "next-auth" module in v5
  interface JWT {
    role: UserRole;
    phone?: string | null;
  }
}
