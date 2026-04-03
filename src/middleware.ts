import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth.config";

// Dev bypass flag — set to true to skip auth entirely during development
const DEV_BYPASS = process.env.NODE_ENV === "development";

const { auth } = NextAuth(authConfig);

// Edge-compatible middleware — does NOT import db or bcrypt
export default async function middleware(request: NextRequest) {
  // Dev bypass: skip all auth checks in development mode
  if (DEV_BYPASS) {
    return NextResponse.next();
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (auth as any)(request);
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/admin/:path*",
    "/login",
    "/register",
    "/verify",
  ],
};
