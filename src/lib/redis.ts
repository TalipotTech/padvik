/**
 * Redis client singleton for caching and BullMQ job queues.
 * Uses ioredis with lazy initialization.
 */
import Redis from "ioredis";

export const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

let redisInstance: Redis | null = null;

/**
 * Returns a lazily-initialized Redis connection.
 * BullMQ requires `maxRetriesPerRequest: null`.
 */
export function getRedisConnection(): Redis {
  if (!redisInstance) {
    redisInstance = new Redis(REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      retryStrategy(times: number) {
        const delay = Math.min(times * 200, 5000);
        return delay;
      },
    });

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
 * Gracefully close the Redis connection (for CLI scripts / worker shutdown).
 */
export async function closeRedis(): Promise<void> {
  if (redisInstance) {
    await redisInstance.quit();
    redisInstance = null;
  }
}
