import "@/lib/server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getServerEnv } from "@/lib/env";
import { logger } from "@/lib/logger";

/**
 * Tiny HMAC-signed cookie for session ownership.
 *
 *   Cookie value = `${sessionId}.${base64url(hmac_sha256(secret, sessionId))}`
 *
 * The cookie is HttpOnly, Secure (in production), SameSite=Lax. It carries
 * no PII — just the session id — but the HMAC means a client cannot forge
 * a cookie referencing someone else's session id without the server secret.
 */

export const SESSION_COOKIE_NAME = "scopeai_session";

const COOKIE_TTL_SECONDS = 24 * 60 * 60;

function getSecret(): string {
  const env = getServerEnv();
  if (env.SESSION_SECRET) return env.SESSION_SECRET;
  // Dev fallback: a per-process random secret stashed on globalThis so
  // Next.js Fast Refresh module re-evaluation does not rotate it (which
  // would invalidate every prior cookie and 404 the user out). In prod
  // SESSION_SECRET is required.
  if (env.NODE_ENV === "production") {
    throw new Error(
      "SESSION_SECRET is required in production. Set a 32+ char secret.",
    );
  }
  const g = globalThis as { __scopeai_dev_secret?: string };
  if (!g.__scopeai_dev_secret) {
    g.__scopeai_dev_secret = randomBytes(32).toString("hex");
    logger.warn("session_cookie.dev_secret_generated", {
      note: "SESSION_SECRET not set; using ephemeral dev secret",
    });
  }
  return g.__scopeai_dev_secret;
}

function sign(sessionId: string): string {
  const mac = createHmac("sha256", getSecret()).update(sessionId).digest();
  return mac.toString("base64url");
}

export interface CookieOptions {
  name: string;
  value: string;
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: "/";
  maxAge: number;
}

export function buildSessionCookie(sessionId: string): CookieOptions {
  const value = `${sessionId}.${sign(sessionId)}`;
  return {
    name: SESSION_COOKIE_NAME,
    value,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_TTL_SECONDS,
  };
}

/**
 * Verify that a cookie value belongs to the given session id. Constant-time
 * comparison via timingSafeEqual so we don't leak signature bytes via timing.
 */
export function verifySessionCookie(
  cookieValue: string | undefined,
  expectedSessionId: string,
): boolean {
  if (!cookieValue) return false;
  const dot = cookieValue.indexOf(".");
  if (dot <= 0 || dot === cookieValue.length - 1) return false;
  const id = cookieValue.slice(0, dot);
  const sig = cookieValue.slice(dot + 1);
  if (id !== expectedSessionId) return false;
  const expected = sign(expectedSessionId);
  if (sig.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}
