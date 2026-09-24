import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_RAW_INPUT_RETENTION_DAYS, SHARE_EXPIRY_DAYS } from "@/lib/db/schema";

/**
 * PRIV-01: the notice has to describe the code, and the code has to refuse
 * the arrangement the notice says it refuses.
 */

const PRIVACY = readFileSync("app/privacy/page.tsx", "utf8");
const TERMS = readFileSync("app/terms/page.tsx", "utf8");
const LANDING = readFileSync("components/landing/CTA.tsx", "utf8");
const INPUT_BAR = readFileSync("components/chat/InputBar.tsx", "utf8");

/** Fresh modules, so getServerEnv() re-reads process.env. */
async function load() {
  vi.resetModules();
  return (await import("@/lib/env")).getServerEnv;
}

/** A production environment that is valid apart from the model provider. */
function productionOnOpenRouter(): void {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("DATABASE_URL", "postgres://user:pass@db.example.com/aureon");
  vi.stubEnv("SESSION_SECRET", "x".repeat(32));
  vi.stubEnv("ALLOW_MEMORY_STORE", "1");
  vi.stubEnv("LLM_PROVIDER", "openrouter");
  vi.stubEnv("OPENROUTER_API_KEY", "z".repeat(24));
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the privacy notice", () => {
  it("names every processor the app actually sends data to", () => {
    for (const name of ["Gemini", "Vercel", "Postgres", "Upstash", "GitHub"]) {
      expect(PRIVACY).toContain(name);
    }
  });

  it("takes the retention period and the share expiries from the code", () => {
    expect(PRIVACY).toContain("DEFAULT_RAW_INPUT_RETENTION_DAYS");
    expect(PRIVACY).toContain("SHARE_EXPIRY_DAYS");
    // If either changes, the page changes with it rather than going stale.
    expect(DEFAULT_RAW_INPUT_RETENTION_DAYS).toBe(90);
    expect(SHARE_EXPIRY_DAYS).toEqual([7, 30, 90]);
  });

  it("says what a share link is, and how to delete a scope", () => {
    expect(PRIVACY).toMatch(/revoke/i);
    expect(PRIVACY).toMatch(/hard delete/i);
  });

  it("tells people not to paste secrets, where they paste", () => {
    expect(PRIVACY).toMatch(/don&apos;t paste|don't paste/i);
    expect(INPUT_BAR).toMatch(/no passwords, keys/i);
    expect(INPUT_BAR).toContain('href="/privacy"');
  });
});

describe("the terms", () => {
  it("say what a generated scope is not", () => {
    expect(TERMS).toMatch(/not a quote|not a contract/i);
  });

  it("link to the privacy notice", () => {
    expect(TERMS).toContain('href="/privacy"');
  });
});

describe("the landing page", () => {
  it("no longer claims the input is dropped after 24 hours", () => {
    expect(LANDING).not.toMatch(/24 hours/i);
  });

  it("links to both pages", () => {
    expect(LANDING).toContain('href="/privacy"');
    expect(LANDING).toContain('href="/terms"');
  });
});

describe("free model providers", () => {
  it("are refused in production", async () => {
    productionOnOpenRouter();
    const getServerEnv = await load();
    expect(() => getServerEnv()).toThrow(/free third-party model providers/);
  });

  it("are allowed in production when someone says so out loud", async () => {
    productionOnOpenRouter();
    vi.stubEnv("ALLOW_FREE_MODELS", "1");
    const getServerEnv = await load();
    expect(() => getServerEnv()).not.toThrow();
  });

  it("are fine in development, which is what they are for", async () => {
    productionOnOpenRouter();
    vi.stubEnv("NODE_ENV", "development");
    const getServerEnv = await load();
    expect(() => getServerEnv()).not.toThrow();
  });
});
