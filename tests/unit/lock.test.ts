import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acquireLock, releaseLock, sessionLockKey } from "@/lib/storage/lock";

// Switchable fake Upstash client: null = not configured (in-memory locks).
const fake = vi.hoisted(() => ({
  redis: null as null | {
    set: (
      key: string,
      value: string,
      opts: { nx: true; ex: number },
    ) => Promise<"OK" | null>;
    eval: (script: string, keys: string[], args: string[]) => Promise<number>;
  },
}));
vi.mock("@/lib/storage/redis", () => ({ getRedis: () => fake.redis }));

let n = 0;
const freshKey = () => sessionLockKey(`unit-${++n}`);

beforeEach(() => {
  fake.redis = null;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("in-memory locks", () => {
  it("names session locks lock:session:<id>", () => {
    expect(sessionLockKey("abc")).toBe("lock:session:abc");
  });

  it("gives the lock to one caller at a time", async () => {
    const key = freshKey();
    const first = await acquireLock(key, 30);
    expect(first).toEqual(expect.any(String));
    expect(await acquireLock(key, 30)).toBeNull();
  });

  it("is atomic when two callers race", async () => {
    const key = freshKey();
    const results = await Promise.all([acquireLock(key, 30), acquireLock(key, 30)]);
    expect(results.filter((t) => t !== null)).toHaveLength(1);
  });

  it("only releases with the owner's token", async () => {
    const key = freshKey();
    const token = (await acquireLock(key, 30))!;
    expect(await releaseLock(key, "not-the-token")).toBe(false);
    expect(await acquireLock(key, 30)).toBeNull();

    expect(await releaseLock(key, token)).toBe(true);
    expect(await acquireLock(key, 30)).not.toBeNull();
  });

  it("expires after its TTL so a crashed request cannot hold it forever", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-22T12:00:00Z"));
    const key = freshKey();
    const stale = (await acquireLock(key, 90))!;

    vi.setSystemTime(new Date("2026-09-22T12:01:31Z")); // 91 s later
    const fresh = await acquireLock(key, 90);
    expect(fresh).not.toBeNull();
    // The expired owner cannot release the new owner's lock.
    expect(await releaseLock(key, stale)).toBe(false);
  });
});

describe("Upstash locks", () => {
  it("acquires with SET NX EX and releases with a compare-and-delete script", async () => {
    const set = vi.fn(async () => "OK" as const);
    const evalScript = vi.fn(async () => 1);
    fake.redis = { set, eval: evalScript };

    const token = await acquireLock("lock:session:x", 90);
    expect(set).toHaveBeenCalledWith("lock:session:x", token, { nx: true, ex: 90 });

    expect(await releaseLock("lock:session:x", token!)).toBe(true);
    const [script, keys, args] = evalScript.mock.calls[0] as unknown as [
      string,
      string[],
      string[],
    ];
    expect(script).toContain('redis.call("get", KEYS[1]) == ARGV[1]');
    expect(script).toContain('redis.call("del", KEYS[1])');
    expect(keys).toEqual(["lock:session:x"]);
    expect(args).toEqual([token]);
  });

  it("returns null when SET NX finds the key taken", async () => {
    fake.redis = { set: async () => null, eval: async () => 0 };
    expect(await acquireLock("lock:session:y", 90)).toBeNull();
    expect(await releaseLock("lock:session:y", "someone-else")).toBe(false);
  });
});
