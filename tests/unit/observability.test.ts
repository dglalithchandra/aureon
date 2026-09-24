import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { reportError } from "@/lib/observability/report";

/**
 * OBS-01: a failure has to be traceable — which session, which request —
 * and reportable somewhere other than a log nobody reads.
 */

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("the error reporter", () => {
  it("sends nothing when no webhook is configured", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    vi.stubEnv("ERROR_WEBHOOK_URL", "");

    await reportError(new Error("boom"), { where: "POST /api/finalize" });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts a shape, not the content, when one is", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    vi.stubEnv("ERROR_WEBHOOK_URL", "https://hooks.example.com/errors");
    vi.stubEnv("ERROR_WEBHOOK_TOKEN", "secret-token");

    await reportError(new Error("boom"), {
      where: "POST /api/finalize",
      requestId: "req-1",
      sessionId: "sess-1",
      detail: { attempts: 2 },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://hooks.example.com/errors");
    expect((init.headers as Record<string, string>).authorization).toBe(
      "Bearer secret-token",
    );
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      name: "Error",
      message: "boom",
      where: "POST /api/finalize",
      requestId: "req-1",
      sessionId: "sess-1",
    });
  });

  it("swallows its own failure, so reporting never becomes the failure", async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new Error("network down")) as unknown as typeof fetch;
    vi.stubEnv("ERROR_WEBHOOK_URL", "https://hooks.example.com/errors");

    await expect(
      reportError(new Error("boom"), { where: "POST /api/finalize" }),
    ).resolves.toBeUndefined();
  });
});

describe("request ids", () => {
  const PROXY = readFileSync("proxy.ts", "utf8");

  it("are put on every response by the proxy", () => {
    expect(PROXY).toContain("X-Request-Id");
    expect(PROXY).toContain("x-request-id");
  });

  it("keep an id the caller already supplied", () => {
    expect(PROXY).toContain('req.headers.get("x-request-id") ??');
  });
});

describe("pipeline logs", () => {
  it.each([
    ["lib/pipeline/extract.ts", "extract.provider_failure"],
    ["lib/pipeline/mcq.ts", "mcq.provider_failure"],
    ["lib/pipeline/finalize.ts", "finalize.client.failure"],
    ["lib/pipeline/github-enrich.ts", "github.enrich.zod_failure"],
  ])("%s carries a session id on %s", (file, event) => {
    const source = readFileSync(file, "utf8");
    const at = source.indexOf(event);
    expect(at).toBeGreaterThan(-1);
    // The session id is in the same log call, within a few lines of it.
    expect(source.slice(at, at + 200)).toContain("sessionId");
  });
});
