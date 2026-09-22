import "@/lib/server-only";
import { getServerEnv } from "@/lib/env";
import { BudgetExceededError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { getRedis } from "@/lib/storage/redis";

/**
 * Global daily LLM budget: every model call increments `llm:calls:YYYY-MM-DD`
 * (UTC day, kept 48 h) before it is made. Once the count passes
 * LLM_DAILY_CALL_LIMIT, calls fail with BudgetExceededError (HTTP 503), which
 * caps the spend a script can cause even if it rotates IPs.
 */

const COUNTER_TTL_SECONDS = 48 * 60 * 60;

export function llmBudgetKey(now: Date = new Date()): string {
  return `llm:calls:${now.toISOString().slice(0, 10)}`;
}

interface MemoryCounter {
  count: number;
  expiresAt: number;
}

/** Per-process fallback when Upstash is not configured (dev and tests). */
const memory: Map<string, MemoryCounter> = (() => {
  const g = globalThis as { __scopeai_llm_budget?: Map<string, MemoryCounter> };
  if (!g.__scopeai_llm_budget) g.__scopeai_llm_budget = new Map();
  return g.__scopeai_llm_budget;
})();

async function increment(key: string): Promise<number | null> {
  const redis = getRedis();
  if (redis) {
    try {
      const count = await redis.incr(key);
      if (count === 1) await redis.expire(key, COUNTER_TTL_SECONDS);
      return count;
    } catch (err) {
      // Fail open: a Redis outage should not take the whole product down.
      logger.error("llm.budget.redis_failure", {
        message: err instanceof Error ? err.message : "unknown",
      });
      return null;
    }
  }
  const now = Date.now();
  const entry = memory.get(key);
  if (!entry || entry.expiresAt < now) {
    memory.set(key, { count: 1, expiresAt: now + COUNTER_TTL_SECONDS * 1000 });
    return 1;
  }
  entry.count += 1;
  return entry.count;
}

/**
 * True when today's budget is already used up, without counting a call.
 * Routes check it before queueing work, so an exhausted budget still answers
 * 503 straight away instead of failing later inside a job.
 */
export async function isLlmBudgetExhausted(now: Date = new Date()): Promise<boolean> {
  const key = llmBudgetKey(now);
  const limit = getServerEnv().LLM_DAILY_CALL_LIMIT;
  const redis = getRedis();
  if (redis) {
    try {
      const count = await redis.get<number | string>(key);
      return Number(count ?? 0) >= limit;
    } catch {
      return false; // fail open, like consumeLlmBudget
    }
  }
  const entry = memory.get(key);
  return Boolean(entry && entry.expiresAt >= Date.now() && entry.count >= limit);
}

/**
 * Count one LLM call against today's budget. Throws BudgetExceededError when
 * the new count is above LLM_DAILY_CALL_LIMIT; returns the count otherwise.
 */
export async function consumeLlmBudget(now: Date = new Date()): Promise<number | null> {
  const key = llmBudgetKey(now);
  const count = await increment(key);
  const limit = getServerEnv().LLM_DAILY_CALL_LIMIT;
  if (count !== null && count > limit) {
    logger.warn("llm.budget.exceeded", { key, count, limit });
    throw new BudgetExceededError();
  }
  return count;
}
