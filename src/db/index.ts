import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * Drizzle client with HMR-safe singleton.
 * During Next.js dev, HMR re-imports modules but globalThis persists,
 * preventing stale connection errors after code changes.
 */

const globalForDb = globalThis as unknown as {
  _pgClient: ReturnType<typeof postgres> | undefined;
  _drizzleDb: PostgresJsDatabase<typeof schema> | undefined;
};

function createDb(): PostgresJsDatabase<typeof schema> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL environment variable is not set");
  }

  if (!globalForDb._pgClient) {
    globalForDb._pgClient = postgres(connectionString, {
      max: 10, // connection pool size
      idle_timeout: 20,
      connect_timeout: 10,
    });
  }

  if (!globalForDb._drizzleDb) {
    globalForDb._drizzleDb = drizzle(globalForDb._pgClient, { schema });
  }

  return globalForDb._drizzleDb;
}

export function getDb(): PostgresJsDatabase<typeof schema> {
  return createDb();
}

/**
 * Direct export — works in both Next.js and CLI/worker contexts.
 * Uses Proxy to lazily initialize on first property access.
 */
export const db = new Proxy({} as PostgresJsDatabase<typeof schema>, {
  get(_target, prop) {
    return (createDb() as unknown as Record<string | symbol, unknown>)[prop];
  },
});
