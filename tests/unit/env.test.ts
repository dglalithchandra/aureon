import { afterEach, describe, expect, it, vi } from "vitest";

/** DATA-01: production refuses to start on per-instance memory storage. */

/** Fresh modules, so getServerEnv() re-reads process.env. */
async function load() {
  vi.resetModules();
  const [env, instrumentation] = await Promise.all([
    import("@/lib/env"),
    import("@/instrumentation"),
  ]);
  return { getServerEnv: env.getServerEnv, register: instrumentation.register };
}

function production(): void {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  // Projects live in Postgres, so production also needs a database; the
  // test below covers what happens without one.
  vi.stubEnv("DATABASE_URL", "postgres://user:pass@db.example.com/aureon");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("production storage requirement", () => {
  it("a production env without a database throws at startup", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://example.upstash.io");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "test-token-0000000000");
    const { getServerEnv } = await load();

    expect(() => getServerEnv()).toThrow(/DATABASE_URL/);
  });

  it("a production env without Upstash throws at startup", async () => {
    production();
    const { getServerEnv, register } = await load();

    expect(() => getServerEnv()).toThrow(/UPSTASH_REDIS_REST_URL/);
    await expect(register()).rejects.toThrow(/ALLOW_MEMORY_STORE=1/);
  });

  it("starts with Upstash configured", async () => {
    production();
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://example.upstash.io");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "test-token-0000000000");
    const { getServerEnv, register } = await load();

    expect(() => getServerEnv()).not.toThrow();
    await expect(register()).resolves.toBeUndefined();
  });

  it("starts on memory storage only when ALLOW_MEMORY_STORE=1", async () => {
    production();
    vi.stubEnv("ALLOW_MEMORY_STORE", "1");
    const { register } = await load();
    await expect(register()).resolves.toBeUndefined();
  });

  it("does not require Upstash outside production", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    const { getServerEnv, register } = await load();

    expect(getServerEnv().UPSTASH_REDIS_REST_URL).toBeUndefined();
    await expect(register()).resolves.toBeUndefined();
  });
});
