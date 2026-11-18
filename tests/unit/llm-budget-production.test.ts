import { beforeEach, describe, expect, it, vi } from "vitest";
import { BudgetExceededError } from "@/lib/errors";

const state = vi.hoisted(() => ({
  redis: {
    get: vi.fn(async () => {
      throw new Error("Redis unavailable");
    }),
    incr: vi.fn(async () => {
      throw new Error("Redis unavailable");
    }),
  },
}));

vi.mock("@/lib/env", () => ({
  getServerEnv: () => ({ NODE_ENV: "production", LLM_DAILY_CALL_LIMIT: 100 }),
}));
vi.mock("@/lib/storage/redis", () => ({ getRedis: () => state.redis }));

import { consumeLlmBudget, isLlmBudgetExhausted } from "@/lib/llm/budget";

describe("production LLM budget outage policy", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fails the preflight check closed when Redis cannot be read", async () => {
    await expect(isLlmBudgetExhausted()).resolves.toBe(true);
  });

  it("blocks a paid call when Redis cannot increment the counter", async () => {
    await expect(consumeLlmBudget()).rejects.toBeInstanceOf(BudgetExceededError);
  });
});
