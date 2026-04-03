import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * Lazy-initialized Drizzle client.
 * This ensures DATABASE_URL is read after dotenv has loaded
 * (important for CLI scripts and workers that run outside Next.js).
 */
let _db: PostgresJsDatabase<typeof schema> | null = null;

export function getDb(): PostgresJsDatabase<typeof schema> {
  if (!_db) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL environment variable is not set");
    }
    const client = postgres(connectionString);
    _db = drizzle(client, { schema });
  }
  return _db;
}

/**
 * Direct export for backward compatibility.
 * In Next.js this works fine because env vars are loaded before module init.
 * In CLI/worker scripts, getDb() is preferred.
 */
export const db = new Proxy({} as PostgresJsDatabase<typeof schema>, {
  get(_target, prop) {
    return (getDb() as unknown as Record<string | symbol, unknown>)[prop];
  },
});
