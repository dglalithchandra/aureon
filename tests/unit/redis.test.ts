import { afterEach, describe, expect, it, vi } from "vitest";

// lib/env caches the environment on first read, so each case re-imports the
// modules after adjusting process.env.
async function freshGetRedis() {
  vi.resetModules();
  return (await import("@/lib/storage/redis")).getRedis;
}

afterEach(() => {
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  vi.resetModules();
});

describe("getRedis", () => {
  it("returns null when Upstash is not configured", async () => {
    const getRedis = await freshGetRedis();
    expect(getRedis()).toBeNull();
  });

  it("creates one client and reuses it", async () => {
    // Constructing the client makes no request; tests/setup.ts blocks the network anyway.
    process.env.UPSTASH_REDIS_REST_URL = "https://example-test.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "test-token-0123456789";
    const getRedis = await freshGetRedis();

    const first = getRedis();
    expect(first).not.toBeNull();
    expect(getRedis()).toBe(first);
  });
});
