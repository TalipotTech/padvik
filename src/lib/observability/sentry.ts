/**
 * Centralized error reporting.
 *
 * reportError() sends caught exceptions to Sentry (when SENTRY_DSN is set) and
 * always logs a structured line to stdout, so failures are debuggable in
 * production via the platform log aggregator AND the Sentry dashboard — without
 * needing access to a dev terminal.
 *
 * Sentry is inert when no DSN is configured (no network, no noise).
 */
import * as Sentry from "@sentry/nextjs";

let initialized = false;

function ensureInit(): void {
  if (initialized) return;
  initialized = true;
  if (process.env.SENTRY_DSN && !Sentry.getClient()) {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV,
      tracesSampleRate: 0, // errors only; raise to sample performance traces
    });
  }
}

export interface ErrorContext {
  /** Short label for where this happened, e.g. "api:auto-content:generate". */
  where?: string;
  [key: string]: unknown;
}

/** Report a caught error to Sentry (if configured) and the server logs. */
export function reportError(error: unknown, context?: ErrorContext): void {
  ensureInit();
  const where = context?.where ?? "app";

  if (process.env.SENTRY_DSN) {
    Sentry.captureException(error, {
      tags: { where: String(where) },
      extra: context as Record<string, unknown> | undefined,
    });
  }

  console.error(
    `[error:${where}]`,
    error instanceof Error ? (error.stack ?? error.message) : error
  );
}
