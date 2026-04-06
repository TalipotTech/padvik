/**
 * Redis client for caching and BullMQ job queues.
 * Uses ioredis with lazy initialization.
 *
 * IMPORTANT: BullMQ workers need their own dedicated Redis connections.
 * Use `getRedisConnection()` for queues (shared singleton).
 * Use `createRedisConnection()` for workers (new connection each time).
 */
import Redis from "ioredis";

export const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

const REDIS_OPTIONS = {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  retryStrategy(times: number) {
    const delay = Math.min(times * 200, 5000);
    return delay;
  },
};

let redisInstance: Redis | null = null;

/**
 * Returns a lazily-initialized shared Redis connection.
 * Used for Queue instances (adding jobs, checking status).
 */
export function getRedisConnection(): Redis {
  if (!redisInstance) {
    redisInstance = new Redis(REDIS_URL, REDIS_OPTIONS);

    redisInstance.on("error", (err) => {
      console.error("[Redis] Connection error:", err.message);
    });

    redisInstance.on("connect", () => {
      console.log("[Redis] Connected to", REDIS_URL);
    });
  }

  return redisInstance;
}

/**
 * Creates a NEW dedicated Redis connection.
 * BullMQ Workers MUST use their own connection (not the shared singleton)
 * because workers use blocking commands that conflict with other operations.
 */
export function createRedisConnection(): Redis {
  const conn = new Redis(REDIS_URL, REDIS_OPTIONS);

  conn.on("error", (err) => {
    console.error("[Redis:Worker] Connection error:", err.message);
  });

  return conn;
}

/**
 * Gracefully close the Redis connection (for CLI scripts / worker shutdown).
 */
export async function closeRedis(): Promise<void> {
  if (redisInstance) {
    await redisInstance.quit();
    redisInstance = null;
  }
}
