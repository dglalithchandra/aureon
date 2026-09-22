import { Ratelimit } from "@upstash/ratelimit";
import { getRedis } from "@/lib/storage/redis";

/**
 * Distributed rate limiter backed by Upstash Redis.
 *
 * Falls back to an in-memory limiter (per-process) when Upstash credentials
 * are not configured. The in-memory variant is suitable only for local dev —
 * it does NOT protect a multi-instance production deployment.
 */

let apiLimiter: Ratelimit | null = null;

export function getApiRateLimiter(): Ratelimit | null {
  if (apiLimiter) return apiLimiter;
  const redis = getRedis();
  if (!redis) return null;
  apiLimiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(10, "60 s"),
    analytics: false,
    prefix: "scopeai:api",
  });
  return apiLimiter;
}

/* ──────────────────────────────────────────────────────────────
 * In-memory fallback (dev only). Survives Fast Refresh via globalThis.
 * ────────────────────────────────────────────────────────────── */
type Bucket = { count: number; resetAt: number };

const memoryBuckets: Map<string, Bucket> = (() => {
  const g = globalThis as { __scopeai_ratelimit_buckets?: Map<string, Bucket> };
  if (!g.__scopeai_ratelimit_buckets) {
    g.__scopeai_ratelimit_buckets = new Map<string, Bucket>();
  }
  return g.__scopeai_ratelimit_buckets;
})();

export interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  reset: number;
}

export async function checkRateLimit(identifier: string): Promise<RateLimitResult> {
  const limiter = getApiRateLimiter();
  if (limiter) {
    const result = await limiter.limit(identifier);
    return {
      success: result.success,
      limit: result.limit,
      remaining: result.remaining,
      reset: result.reset,
    };
  }

  // In-memory fallback
  const LIMIT = 10;
  const WINDOW_MS = 60_000;
  const now = Date.now();
  const bucket = memoryBuckets.get(identifier);

  if (!bucket || bucket.resetAt < now) {
    const fresh: Bucket = { count: 1, resetAt: now + WINDOW_MS };
    memoryBuckets.set(identifier, fresh);
    return {
      success: true,
      limit: LIMIT,
      remaining: LIMIT - 1,
      reset: fresh.resetAt,
    };
  }

  bucket.count += 1;
  return {
    success: bucket.count <= LIMIT,
    limit: LIMIT,
    remaining: Math.max(0, LIMIT - bucket.count),
    reset: bucket.resetAt,
  };
}
