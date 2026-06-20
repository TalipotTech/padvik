/**
 * Client-side (browser) instrumentation. Next.js loads this automatically on
 * the client. Initializes Sentry only when NEXT_PUBLIC_SENTRY_DSN is set, so it
 * stays inert (no network, no bundle cost beyond the SDK) without a DSN.
 */
import * as Sentry from "@sentry/nextjs";

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0, // errors only
  });
}

// Instruments App Router client-side navigations for Sentry.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
