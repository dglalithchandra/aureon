import { describe, expect, it } from "vitest";
import { buildCsp, newNonce } from "@/lib/security/csp";
import nextConfig from "@/next.config";

/** SEC-03: a nonce policy in production, and nothing the browser cannot use. */

const prod = (): string => buildCsp({ nonce: "test-nonce", dev: false });
const dev = (): string => buildCsp({ nonce: "test-nonce", dev: true });

function directive(policy: string, name: string): string {
  const found = policy
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name} `));
  if (!found) throw new Error(`no ${name} in ${policy}`);
  return found;
}

describe("the production policy", () => {
  it("trusts scripts by nonce, not by being inline", () => {
    const scripts = directive(prod(), "script-src");
    expect(scripts).toContain("'nonce-test-nonce'");
    expect(scripts).toContain("'strict-dynamic'");
    expect(scripts).not.toContain("'unsafe-inline'");
  });

  it("does not allow eval", () => {
    expect(prod()).not.toContain("'unsafe-eval'");
  });

  it("upgrades insecure requests", () => {
    expect(prod()).toContain("upgrade-insecure-requests");
  });

  it("names the app's own origin as the default", () => {
    expect(directive(prod(), "default-src")).toBe("default-src 'self'");
    expect(directive(prod(), "object-src")).toBe("object-src 'none'");
    expect(directive(prod(), "frame-ancestors")).toBe("frame-ancestors 'none'");
  });

  it("lets the browser reach only what the browser actually calls", () => {
    const connect = directive(prod(), "connect-src");
    expect(connect).toContain("'self'");
    // Server-side APIs have no business in a browser allow-list.
    expect(connect).not.toContain("googleapis.com");
    expect(connect).not.toContain("api.github.com");
    expect(connect).not.toContain("anthropic.com");
    expect(connect).not.toContain("upstash.io");
  });

  it("still allows the fonts and images the pages load", () => {
    expect(directive(prod(), "font-src")).toContain("https://fonts.gstatic.com");
    expect(directive(prod(), "style-src")).toContain("https://fonts.googleapis.com");
    expect(directive(prod(), "img-src")).toContain(
      "https://avatars.githubusercontent.com",
    );
  });
});

describe("the development policy", () => {
  it("allows eval, which React needs for its debugging stacks", () => {
    expect(directive(dev(), "script-src")).toContain("'unsafe-eval'");
  });

  it("does not upgrade to https, because the dev server is http", () => {
    expect(dev()).not.toContain("upgrade-insecure-requests");
  });

  it("still keeps the nonce", () => {
    expect(directive(dev(), "script-src")).toContain("'nonce-test-nonce'");
  });
});

describe("the nonce", () => {
  it("is different every time", () => {
    const nonces = new Set(Array.from({ length: 100 }, () => newNonce()));
    expect(nonces.size).toBe(100);
  });

  it("is long enough not to be guessed", () => {
    expect(newNonce().length).toBeGreaterThanOrEqual(32);
  });
});

describe("next.config.ts", () => {
  it("does not set a second, weaker policy of its own", async () => {
    const groups = (await nextConfig.headers?.()) ?? [];
    const keys = groups.flatMap((group) => group.headers.map((h) => h.key.toLowerCase()));
    expect(keys).not.toContain("content-security-policy");
    // The headers that do not change per request stay there.
    expect(keys).toContain("strict-transport-security");
    expect(keys).toContain("x-content-type-options");
  });
});
