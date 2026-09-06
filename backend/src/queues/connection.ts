import IORedis, { Redis } from "ioredis";
import { config } from "../config";

// BullMQ requires maxRetriesPerRequest to be null on the connection it is
// given, otherwise blocking commands (used internally by Workers) will not
// behave correctly.
export function createRedisConnection(): Redis {
  const client = new IORedis(config.redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: false,
  });
  client.on("error", () => {
    // Handled reconnection attempt
  });
  return client;
}

// A single general-purpose connection shared for rate limiting / idempotency
// helpers that live outside of BullMQ itself (see services/rateLimiter.ts).
export const redis = createRedisConnection();
