import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { consumeLlmBudget, llmBudgetKey } from "@/lib/llm/budget";
import { BudgetExceededError } from "@/lib/errors";
import { POST as runRoute } from "@/app/api/session/[id]/run/route";
import { createSession } from "@/lib/pipeline/orchestrator";
import { putSession } from "@/lib/storage/session";
import { buildSessionCookie, SESSION_COOKIE_NAME } from "@/lib/security/session-cookie";
import { startMockAnthropic, type MockAnthropic } from "../mocks/mock-anthropic";

// Budget for this file. getServerEnv() reads it lazily on the first call.
process.env.LLM_DAILY_CALL_LIMIT = "3";

// A switchable fake Upstash client: null means "not configured" (memory path).
const fake = vi.hoisted(() => ({
  redis: null as null | {
    incr: (key: string) => Promise<number>;
    expire: (key: string, seconds: number) => Promise<number>;
  },
}));
vi.mock("@/lib/storage/redis", () => ({ getRedis: () => fake.redis }));

function resetMemoryBudget(): void {
  (
    globalThis as { __scopeai_llm_budget?: Map<string, unknown> }
  ).__scopeai_llm_budget?.clear();
}

let mock: MockAnthropic;

beforeAll(async () => {
  mock = await startMockAnthropic();
  process.env.ANTHROPIC_BASE_URL = mock.url;
});

afterAll(async () => {
  await mock.close();
});

beforeEach(() => {
  fake.redis = null;
  resetMemoryBudget();
  mock.reset();
});

describe("consumeLlmBudget", () => {
  it("keys the counter by UTC day", () => {
    expect(llmBudgetKey(new Date("2026-09-22T23:59:00Z"))).toBe("llm:calls:2026-09-22");
  });

  it("allows calls up to the limit, then throws a 503 BUDGET_EXCEEDED error", async () => {
    expect(await consumeLlmBudget()).toBe(1);
    expect(await consumeLlmBudget()).toBe(2);
    expect(await consumeLlmBudget()).toBe(3);

    const err = await consumeLlmBudget().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BudgetExceededError);
    expect(err).toMatchObject({ code: "BUDGET_EXCEEDED", statusCode: 503 });
  });

  it("starts a fresh count on a new day", async () => {
    const day1 = new Date("2026-09-22T10:00:00Z");
    const day2 = new Date("2026-09-23T10:00:00Z");
    for (let i = 0; i < 3; i++) await consumeLlmBudget(day1);
    await expect(consumeLlmBudget(day1)).rejects.toBeInstanceOf(BudgetExceededError);
    expect(await consumeLlmBudget(day2)).toBe(1);
  });

  it("uses Redis INCR with a 48 h expiry when Upstash is configured", async () => {
    const counts = new Map<string, number>();
    const expire = vi.fn(async () => 1);
    fake.redis = {
      incr: async (key) => {
        const n = (counts.get(key) ?? 0) + 1;
        counts.set(key, n);
        return n;
      },
      expire,
    };

    const now = new Date("2026-09-22T12:00:00Z");
    await consumeLlmBudget(now);
    await consumeLlmBudget(now);

    expect(counts.get("llm:calls:2026-09-22")).toBe(2);
    expect(expire).toHaveBeenCalledTimes(1);
    expect(expire).toHaveBeenCalledWith("llm:calls:2026-09-22", 48 * 60 * 60);
  });
});

describe("POST /api/session/:id/run with the budget used up", () => {
  it("returns 503 BUDGET_EXCEEDED instead of calling the model", async () => {
    const session = createSession("We need an internal tool for account managers.");
    await putSession(session);
    // Use up the whole budget before the request.
    for (let i = 0; i < 3; i++) await consumeLlmBudget();

    const req = new NextRequest(`http://localhost/api/session/${session.id}/run`, {
      method: "POST",
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${buildSessionCookie(session.id).value}`,
        "x-forwarded-for": "198.51.100.70",
      },
    });
    const res = await runRoute(req, { params: Promise.resolve({ id: session.id }) });

    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: { code: "BUDGET_EXCEEDED" } });
    expect(mock.calls).toHaveLength(0);
  });

  it("stops mid-round when the budget runs out between LLM calls", async () => {
    const session = createSession("We need an internal tool for account managers.");
    await putSession(session);
    // 2 used: the extraction (3rd) is allowed, the question call (4th) is not.
    for (let i = 0; i < 2; i++) await consumeLlmBudget();

    const req = new NextRequest(`http://localhost/api/session/${session.id}/run`, {
      method: "POST",
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${buildSessionCookie(session.id).value}`,
        "x-forwarded-for": "198.51.100.71",
      },
    });
    const res = await runRoute(req, { params: Promise.resolve({ id: session.id }) });

    expect(res.status).toBe(503);
    expect(mock.calls.map((c) => c.tool)).toEqual(["submit_extraction"]);
  });
});
