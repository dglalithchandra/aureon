import "@/lib/server-only";
import { Redis } from "@upstash/redis";
import { getServerEnv, hasUpstash } from "@/lib/env";

/**
 * The one Upstash Redis client shared by sessions, shares, the cache and the
 * rate limiter. Returns null when Upstash is not configured; callers then use
 * their per-process in-memory fallback.
 */

let client: Redis | null = null;

export function getRedis(): Redis | null {
  if (!hasUpstash()) return null;
  if (client) return client;
  const env = getServerEnv();
  client = new Redis({
    url: env.UPSTASH_REDIS_REST_URL!,
    token: env.UPSTASH_REDIS_REST_TOKEN!,
  });
  return client;
}
