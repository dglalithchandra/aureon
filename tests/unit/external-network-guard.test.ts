import { describe, expect, it, vi } from "vitest";
import { guardedFetch } from "@/lib/testing/external-network-guard";

describe("E2E external network guard", () => {
  it("rejects a real provider origin before calling fetch", async () => {
    const delegate = vi.fn<typeof fetch>();
    const fetch = guardedFetch(delegate);

    await expect(fetch("https://openrouter.ai/api/v1/chat/completions")).rejects.toThrow(
      "External network access is blocked",
    );
    expect(delegate).not.toHaveBeenCalled();
  });

  it.each([
    "http://127.0.0.1:3210/api/health",
    "http://localhost:3210/chat",
    "http://[::1]:3210/mock",
  ])("allows loopback request %s", async (url) => {
    const response = new Response(null, { status: 204 });
    const delegate = vi.fn<typeof fetch>().mockResolvedValue(response);

    await expect(guardedFetch(delegate)(url)).resolves.toBe(response);
    expect(delegate).toHaveBeenCalledOnce();
  });
});
