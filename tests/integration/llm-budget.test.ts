import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { consumeLlmBudget, isLlmBudgetExhausted, llmBudgetKey } from "@/lib/llm/budget";
import { BudgetExceededError } from "@/lib/errors";
import { POST as runRoute } from "@/app/api/session/[id]/run/route";
import { createSession } from "@/lib/pipeline/orchestrator";
import { getSession, putSession } from "@/lib/storage/session";
import { buildSessionCookie, SESSION_COOKIE_NAME } from "@/lib/security/session-cookie";
import { startMockAnthropic, type MockAnthropic } from "../mocks/mock-anthropic";
import { drainJobs, queuedJobs, resetJobQueue } from "../mocks/job-queue";

vi.mock("@/lib/jobs/transport", () => import("../mocks/job-queue"));

// Budget for this file. getServerEnv() reads it lazily on the first call.
process.env.LLM_DAILY_CALL_LIMIT = "3";

// A switchable fake Upstash client: null means "not configured" (memory path).
const fake = vi.hoisted(() => ({
  redis: null as null | {
    incr?: (key: string) => Promise<number>;
    expire?: (key: string, seconds: number) => Promise<number>;
    get?: (key: string) => Promise<unknown>;
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
  resetJobQueue();
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

  it("isLlmBudgetExhausted checks the count without spending a call", async () => {
    await consumeLlmBudget();
    await consumeLlmBudget();
    expect(await isLlmBudgetExhausted()).toBe(false);
    await consumeLlmBudget();
    expect(await isLlmBudgetExhausted()).toBe(true);
    expect(await isLlmBudgetExhausted()).toBe(true); // still 3, not 4

    // Upstash returns the INCR counter as a number or a string.
    fake.redis = { get: async () => "3" };
    expect(await isLlmBudgetExhausted()).toBe(true);
    fake.redis = { get: async () => 2 };
    expect(await isLlmBudgetExhausted()).toBe(false);
    fake.redis = { get: async () => null };
    expect(await isLlmBudgetExhausted()).toBe(false);
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
  it("returns 503 BUDGET_EXCEEDED instead of queueing a round", async () => {
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
    expect(queuedJobs).toHaveLength(0);
    expect(mock.calls).toHaveLength(0);
    // Stored like a round that hit the budget, so the chat can say why.
    expect(await getSession(session.id)).toMatchObject({
      status: "error",
      last_error: { code: "BUDGET_EXCEEDED", retryable: false },
    });
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

    expect(res.status).toBe(202);
    expect(await drainJobs()).toEqual(["failed"]);
    expect(mock.calls.map((c) => c.tool)).toEqual(["submit_extraction"]);
    expect(await getSession(session.id)).toMatchObject({
      status: "error",
      last_error: { code: "BUDGET_EXCEEDED", retryable: false },
    });
  });
});
