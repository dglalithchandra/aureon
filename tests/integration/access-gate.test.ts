import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";

function request(path: string, authorization?: string): NextRequest {
  return new NextRequest(`https://aureon.example${path}`, {
    headers: authorization ? { authorization } : undefined,
  });
}

function basic(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("private deployment access gate", () => {
  it("challenges page and normal API requests, then accepts the configured pair", async () => {
    vi.stubEnv("ACCESS_GATE_USERNAME", "judge");
    vi.stubEnv("ACCESS_GATE_PASSWORD", "a-long-demo-password");

    const page = await proxy(request("/chat"));
    const api = await proxy(request("/api/projects"));
    const allowed = await proxy(request("/chat", basic("judge", "a-long-demo-password")));

    expect(page.status).toBe(401);
    expect(page.headers.get("www-authenticate")).toContain("Aureon preview");
    expect(api.status).toBe(401);
    expect(allowed.status).toBe(200);
  });

  it("keeps infrastructure endpoints available for their own authentication", async () => {
    vi.stubEnv("ACCESS_GATE_USERNAME", "judge");
    vi.stubEnv("ACCESS_GATE_PASSWORD", "a-long-demo-password");

    await expect(proxy(request("/api/health"))).resolves.toHaveProperty("status", 200);
    await expect(proxy(request("/api/jobs/round"))).resolves.toHaveProperty(
      "status",
      200,
    );
    await expect(proxy(request("/api/cron/retention"))).resolves.toHaveProperty(
      "status",
      200,
    );
  });

  it("fails closed when only half of the gate is configured", async () => {
    vi.stubEnv("ACCESS_GATE_USERNAME", "judge");
    vi.stubEnv("ACCESS_GATE_PASSWORD", "");

    await expect(proxy(request("/"))).resolves.toHaveProperty("status", 503);
  });
});
