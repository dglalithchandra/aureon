import "@/lib/server-only";
import { createHash } from "node:crypto";
import { Redis } from "@upstash/redis";
import { getServerEnv, hasUpstash } from "@/lib/env";
import { logger } from "@/lib/logger";

/**
 * Tiny key-value cache. Backed by Upstash Redis when configured;
 * falls back to a per-process in-memory map otherwise (suitable for dev,
 * NOT for multi-instance production).
 */

let redis: Redis | null = null;
function getRedis(): Redis | null {
  if (!hasUpstash()) return null;
  if (redis) return redis;
  const env = getServerEnv();
  redis = new Redis({
    url: env.UPSTASH_REDIS_REST_URL!,
    token: env.UPSTASH_REDIS_REST_TOKEN!,
  });
  return redis;
}

interface MemoryEntry<T> {
  value: T;
  expiresAt: number;
}

const memory: Map<string, MemoryEntry<unknown>> = (() => {
  const g = globalThis as {
    __scopeai_cache_store?: Map<string, MemoryEntry<unknown>>;
  };
  if (!g.__scopeai_cache_store) {
    g.__scopeai_cache_store = new Map<string, MemoryEntry<unknown>>();
  }
  return g.__scopeai_cache_store;
})();

export async function cacheGet<T>(key: string): Promise<T | null> {
  const r = getRedis();
  if (r) {
    try {
      const raw = await r.get<T>(key);
      return raw ?? null;
    } catch (err) {
      logger.warn("cache.get_failure", {
        message: err instanceof Error ? err.message : "unknown",
      });
      return null;
    }
  }
  const entry = memory.get(key) as MemoryEntry<T> | undefined;
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    memory.delete(key);
    return null;
  }
  return entry.value;
}

export async function cacheSet<T>(
  key: string,
  value: T,
  ttlSeconds: number,
): Promise<void> {
  const r = getRedis();
  if (r) {
    try {
      await r.set(key, value, { ex: ttlSeconds });
      return;
    } catch (err) {
      logger.warn("cache.set_failure", {
        message: err instanceof Error ? err.message : "unknown",
      });
      return;
    }
  }
  memory.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

/**
 * Stable, opaque key derived from a string input. SHA-256 truncated to 16
 * bytes — collision-safe for caching and short enough for Redis.
 */
export function hashKey(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 32);
}
