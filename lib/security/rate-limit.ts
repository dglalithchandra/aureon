import { Ratelimit } from "@upstash/ratelimit";
import { getRedis } from "@/lib/storage/redis";

/**
 * Distributed rate limiter backed by Upstash Redis, with one limiter per
 * (limit, window) pair so buckets can have different sizes.
 *
 * Falls back to an in-memory limiter (per-process) when Upstash credentials
 * are not configured. The in-memory variant is suitable only for local dev —
 * it does NOT protect a multi-instance production deployment.
 */

/** Bucket sizes, per client IP. */
export const RATE_LIMITS = {
  /** Cheap status polls: GET /api/session/<id> and GET /api/health. */
  poll: { limit: 120, windowSeconds: 60 },
  /** Every other /api request (applied in proxy.ts). */
  api: { limit: 30, windowSeconds: 60 },
  /** Extra per-route limit on each LLM route: run, answer, finalize. */
  llmRoute: { limit: 6, windowSeconds: 60 },
  /**
   * File import: parsing a PDF or a DOCX is CPU work on bytes someone else
   * chose, so it gets a smaller bucket than the rest of the API.
   */
  upload: { limit: 10, windowSeconds: 60 },
} as const;

const limiters = new Map<string, Ratelimit>();

function getUpstashLimiter(limit: number, windowSeconds: number): Ratelimit | null {
  const key = `${limit}:${windowSeconds}`;
  const cached = limiters.get(key);
  if (cached) return cached;
  const redis = getRedis();
  if (!redis) return null;
  const limiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(limit, `${windowSeconds} s`),
    analytics: false,
    prefix: `scopeai:rl:${limit}:${windowSeconds}`,
  });
  limiters.set(key, limiter);
  return limiter;
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

export async function checkRateLimit(
  identifier: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const limiter = getUpstashLimiter(limit, windowSeconds);
  if (limiter) {
    const result = await limiter.limit(identifier);
    return {
      success: result.success,
      limit: result.limit,
      remaining: result.remaining,
      reset: result.reset,
    };
  }

  // In-memory fallback: fixed window per (limit, window, identifier).
  const bucketKey = `${limit}:${windowSeconds}:${identifier}`;
  const now = Date.now();
  const bucket = memoryBuckets.get(bucketKey);

  if (!bucket || bucket.resetAt < now) {
    const fresh: Bucket = { count: 1, resetAt: now + windowSeconds * 1000 };
    memoryBuckets.set(bucketKey, fresh);
    return { success: true, limit, remaining: limit - 1, reset: fresh.resetAt };
  }

  bucket.count += 1;
  return {
    success: bucket.count <= limit,
    limit,
    remaining: Math.max(0, limit - bucket.count),
    reset: bucket.resetAt,
  };
}
