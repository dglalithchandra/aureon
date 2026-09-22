import { describe, expect, it } from "vitest";
import { checkRateLimit, RATE_LIMITS } from "@/lib/security/rate-limit";

// The in-memory buckets live on globalThis, so every test uses its own ids.

describe("checkRateLimit (in-memory fallback)", () => {
  it("allows exactly `limit` requests per window, then refuses", async () => {
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await checkRateLimit("unit-a", 3, 60));
    expect(results.map((r) => r.success)).toEqual([true, true, true, false]);
    expect(results.map((r) => r.remaining)).toEqual([2, 1, 0, 0]);
    expect(results[0]?.limit).toBe(3);
  });

  it("keeps buckets with different sizes separate for the same identifier", async () => {
    for (let i = 0; i < 2; i++) await checkRateLimit("unit-b", 2, 60);
    expect((await checkRateLimit("unit-b", 2, 60)).success).toBe(false);
    expect((await checkRateLimit("unit-b", 5, 60)).success).toBe(true);
  });

  it("reports when the window resets", async () => {
    const before = Date.now();
    const r = await checkRateLimit("unit-c", 1, 60);
    expect(r.reset).toBeGreaterThanOrEqual(before + 60_000);
  });
});

describe("RATE_LIMITS", () => {
  it("sizes the poll, api and LLM-route buckets", () => {
    expect(RATE_LIMITS).toEqual({
      poll: { limit: 120, windowSeconds: 60 },
      api: { limit: 30, windowSeconds: 60 },
      llmRoute: { limit: 6, windowSeconds: 60 },
    });
  });
});
