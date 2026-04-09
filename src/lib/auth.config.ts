import type { NextAuthConfig } from "next-auth";
import type { UserRole } from "@/types/auth";

/**
 * Edge-compatible auth config — used by middleware.
 * Does NOT import database or bcrypt (Node.js-only modules).
 * Provider authorize() functions are defined in auth.ts instead.
 */
export const authConfig = {
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60,
  },
  pages: {
    signIn: "/login",
    newUser: "/register",
    error: "/login",
  },
  callbacks: {
    async authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const pathname = nextUrl.pathname;

      const protectedRoutes = ["/dashboard", "/admin"];
      const adminRoutes = ["/admin"];
      const authRoutes = ["/login", "/register", "/verify"];

      // Redirect logged-in users away from auth pages
      if (isLoggedIn && authRoutes.some((r) => pathname.startsWith(r))) {
        return Response.redirect(new URL("/dashboard", nextUrl));
      }

      // Protect dashboard routes
      if (protectedRoutes.some((r) => pathname.startsWith(r)) && !isLoggedIn) {
        return false; // NextAuth redirects to signIn page
      }

      // Admin-only routes
      if (adminRoutes.some((r) => pathname.startsWith(r))) {
        const role = auth?.user?.role as UserRole | undefined;
        if (role !== "admin") {
          return Response.redirect(new URL("/dashboard", nextUrl));
        }
      }

      return true;
    },

    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.sub = user.id;
        token.role = (user as { role?: UserRole }).role ?? "student";
        token.phone = (user as { phone?: string | null }).phone;
        token.isCreator = (user as { isCreator?: boolean }).isCreator ?? false;
      }
      if (trigger === "update" && session) {
        if (session.role) token.role = session.role;
        if (typeof session.isCreator === "boolean") token.isCreator = session.isCreator;
      }
      return token;
    },

    async session({ session, token }) {
      if (token.sub) {
        session.user.id = token.sub;
        session.user.role = (token.role as UserRole) ?? "student";
        session.user.phone = token.phone as string | null;
        session.user.isCreator = (token.isCreator as boolean) ?? false;
      }
      return session;
    },

    async redirect({ url, baseUrl }) {
      if (url.startsWith("/")) return `${baseUrl}${url}`;
      if (new URL(url).origin === baseUrl) return url;
      return `${baseUrl}/dashboard`;
    },
  },
  providers: [], // Providers are defined in auth.ts (Node.js-only)
} satisfies NextAuthConfig;
