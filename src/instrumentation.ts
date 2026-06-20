/**
 * Next.js instrumentation hook. Initializes Sentry on the server runtime (only
 * when SENTRY_DSN is set) and wires automatic capture of server-side request
 * errors (route handlers, server components) via onRequestError.
 */
import * as Sentry from "@sentry/nextjs";

export function register(): void {
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.SENTRY_DSN &&
    !Sentry.getClient()
  ) {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV,
      tracesSampleRate: 0,
    });
  }
}

// Next calls this for any error thrown while handling a request — sends it to
// Sentry automatically (no-op when Sentry isn't initialized).
export const onRequestError = Sentry.captureRequestError;
