import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildSessionCookie,
  SESSION_COOKIE_NAME,
  verifySessionCookie,
} from "@/lib/security/session-cookie";

const SESSION_ID = "12345678-1234-4abc-8def-1234567890ab";
const OTHER_ID = "abcdefab-cdef-4abc-8def-abcdefabcdef";

function signWith(secret: string, id: string): string {
  return createHmac("sha256", secret).update(id).digest("base64url");
}

describe("buildSessionCookie", () => {
  const cookie = buildSessionCookie(SESSION_ID);

  it("sets the ownership cookie with safe attributes", () => {
    expect(cookie.name).toBe(SESSION_COOKIE_NAME);
    expect(cookie.name).toBe("scopeai_session");
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe("lax");
    expect(cookie.path).toBe("/");
    expect(cookie.maxAge).toBe(24 * 60 * 60);
  });

  it("is not Secure outside production", () => {
    expect(cookie.secure).toBe(false);
  });

  it("stores `<id>.<hmac>` signed with SESSION_SECRET", () => {
    const secret = process.env.SESSION_SECRET!;
    expect(cookie.value).toBe(`${SESSION_ID}.${signWith(secret, SESSION_ID)}`);
  });
});

describe("verifySessionCookie", () => {
  const valid = buildSessionCookie(SESSION_ID).value;

  it("accepts the cookie it issued", () => {
    expect(verifySessionCookie(valid, SESSION_ID)).toBe(true);
  });

  it("rejects a cookie for a different session id", () => {
    expect(verifySessionCookie(valid, OTHER_ID)).toBe(false);
  });

  it("rejects a cookie signed with a different secret", () => {
    const forged = `${SESSION_ID}.${signWith("some-other-secret-0123456789abcdef", SESSION_ID)}`;
    expect(verifySessionCookie(forged, SESSION_ID)).toBe(false);
  });

  it("rejects a same-length tampered signature", () => {
    const sig = valid.slice(SESSION_ID.length + 1);
    const flipped = (sig[0] === "A" ? "B" : "A") + sig.slice(1);
    expect(flipped).toHaveLength(sig.length);
    expect(verifySessionCookie(`${SESSION_ID}.${flipped}`, SESSION_ID)).toBe(false);
  });

  it("rejects a signature of the wrong length", () => {
    expect(verifySessionCookie(`${SESSION_ID}.deadbeef`, SESSION_ID)).toBe(false);
  });

  it("rejects the signature of one id replayed for another id", () => {
    const sigForOther = buildSessionCookie(OTHER_ID).value.slice(OTHER_ID.length + 1);
    expect(verifySessionCookie(`${SESSION_ID}.${sigForOther}`, SESSION_ID)).toBe(false);
  });

  it.each([
    ["undefined", undefined],
    ["empty", ""],
    ["no dot", "nodothere"],
    ["leading dot", `.${SESSION_ID}`],
    ["trailing dot", `${SESSION_ID}.`],
  ])("rejects a malformed value (%s)", (_label, value) => {
    expect(verifySessionCookie(value, SESSION_ID)).toBe(false);
  });
});
