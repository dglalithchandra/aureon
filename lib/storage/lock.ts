import "@/lib/server-only";
import { randomUUID } from "node:crypto";
import { getRedis } from "@/lib/storage/redis";

/**
 * Single-flight lock so one session never runs two LLM pipelines at once
 * (double click, two tabs, a client retry). Upstash: `SET key token NX EX`,
 * released by a Lua compare-and-delete so a slow request can never delete a
 * lock that expired and was re-acquired by someone else. Without Upstash a
 * per-process Map with expiry is used.
 */

/** `maxDuration` of the LLM routes in vercel.json (run, answer, finalize). */
export const LLM_ROUTE_MAX_DURATION_SECONDS = 60;

/**
 * Lock TTL: the route's maxDuration plus 30 s, so a request the platform
 * killed mid-flight cannot leave the session locked for long.
 */
export const SESSION_LOCK_TTL_SECONDS = LLM_ROUTE_MAX_DURATION_SECONDS + 30;

export function sessionLockKey(sessionId: string): string {
  return `lock:session:${sessionId}`;
}

/** Delete KEYS[1] only if it still holds our token (ARGV[1]). */
const RELEASE_SCRIPT = `if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
end
return 0`;

interface MemoryLock {
  token: string;
  expiresAt: number;
}

const memory: Map<string, MemoryLock> = (() => {
  const g = globalThis as { __scopeai_locks?: Map<string, MemoryLock> };
  if (!g.__scopeai_locks) g.__scopeai_locks = new Map();
  return g.__scopeai_locks;
})();

/** Returns a token when the lock was acquired, or null if someone holds it. */
export async function acquireLock(
  key: string,
  ttlSeconds: number,
): Promise<string | null> {
  const token = randomUUID();
  const redis = getRedis();
  if (redis) {
    const result = await redis.set(key, token, { nx: true, ex: ttlSeconds });
    return result === "OK" ? token : null;
  }

  // No await between the check and the set, so this is atomic in-process.
  const now = Date.now();
  const held = memory.get(key);
  if (held && held.expiresAt > now) return null;
  memory.set(key, { token, expiresAt: now + ttlSeconds * 1000 });
  return token;
}

/** Releases the lock only if `token` still owns it. Returns true if released. */
export async function releaseLock(key: string, token: string): Promise<boolean> {
  const redis = getRedis();
  if (redis) {
    const deleted = await redis.eval<[string], number>(RELEASE_SCRIPT, [key], [token]);
    return deleted === 1;
  }
  const held = memory.get(key);
  if (!held || held.token !== token) return false;
  memory.delete(key);
  return true;
}
