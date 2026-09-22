import { afterEach, describe, expect, it } from "vitest";
import { getClientIp } from "@/lib/security/client-ip";

function req(headers: Record<string, string>): { headers: Headers } {
  return { headers: new Headers(headers) };
}

afterEach(() => {
  delete process.env.VERCEL;
});

describe("getClientIp off Vercel (behind a reverse proxy)", () => {
  it("uses the LAST X-Forwarded-For entry, the one our proxy appended", () => {
    expect(getClientIp(req({ "x-forwarded-for": "6.6.6.6, 203.0.113.7" }))).toBe(
      "203.0.113.7",
    );
  });

  it("never uses a client-supplied first entry", () => {
    const a = getClientIp(req({ "x-forwarded-for": "1.1.1.1, 198.51.100.9" }));
    const b = getClientIp(req({ "x-forwarded-for": "2.2.2.2, 198.51.100.9" }));
    expect(a).toBe("198.51.100.9");
    expect(b).toBe(a);
  });

  it("falls back to X-Real-IP, then 'anonymous'", () => {
    expect(getClientIp(req({ "x-real-ip": " 198.51.100.2 " }))).toBe("198.51.100.2");
    expect(getClientIp(req({}))).toBe("anonymous");
  });

  it("ignores blank headers and empty list entries", () => {
    expect(getClientIp(req({ "x-real-ip": "  " }))).toBe("anonymous");
    expect(getClientIp(req({ "x-forwarded-for": " , 10.0.0.1, " }))).toBe("10.0.0.1");
  });
});

describe("getClientIp on Vercel", () => {
  it("uses the platform-set x-vercel-forwarded-for and ignores X-Forwarded-For", () => {
    process.env.VERCEL = "1";
    expect(
      getClientIp(
        req({
          "x-forwarded-for": "6.6.6.6, 7.7.7.7",
          "x-vercel-forwarded-for": "203.0.113.50",
          "x-real-ip": "203.0.113.50",
        }),
      ),
    ).toBe("203.0.113.50");
  });

  it("falls back to x-real-ip, which Vercel also sets", () => {
    process.env.VERCEL = "1";
    expect(
      getClientIp(req({ "x-forwarded-for": "6.6.6.6", "x-real-ip": "203.0.113.51" })),
    ).toBe("203.0.113.51");
  });
});

describe("route helpers", () => {
  it("re-export the same function", async () => {
    const helpers = await import("@/lib/security/route-helpers");
    expect(helpers.getClientIp).toBe(getClientIp);
  });
});
