import { describe, expect, it } from "vitest";
import { getClientIp } from "@/lib/security/client-ip";

function req(headers: Record<string, string>): { headers: Headers } {
  return { headers: new Headers(headers) };
}

describe("getClientIp", () => {
  it("uses the first X-Forwarded-For entry", () => {
    expect(getClientIp(req({ "x-forwarded-for": " 203.0.113.7 , 10.0.0.1" }))).toBe(
      "203.0.113.7",
    );
  });

  it("falls back to X-Real-IP", () => {
    expect(getClientIp(req({ "x-real-ip": " 198.51.100.2 " }))).toBe("198.51.100.2");
  });

  it("returns 'anonymous' when neither header is set", () => {
    expect(getClientIp(req({}))).toBe("anonymous");
  });

  it("treats blank headers as missing instead of returning an empty key", () => {
    expect(getClientIp(req({ "x-real-ip": "  " }))).toBe("anonymous");
    expect(getClientIp(req({ "x-forwarded-for": " , 10.0.0.1" }))).toBe("anonymous");
  });

  it("is what the route helpers export", async () => {
    const helpers = await import("@/lib/security/route-helpers");
    expect(helpers.getClientIp).toBe(getClientIp);
  });
});
