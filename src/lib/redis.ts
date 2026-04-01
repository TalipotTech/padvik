// Redis client for caching and job queue
// TODO: Implement with ioredis or @upstash/redis

export const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
