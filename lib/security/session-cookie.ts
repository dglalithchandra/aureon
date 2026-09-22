import "@/lib/server-only";
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { getServerEnv } from "@/lib/env";
import { logger } from "@/lib/logger";

/**
 * HMAC-signed cookies for session ownership (BUG-03).
 *
 *   scopeai_owner   = `${ownerId}.${base64url(hmac_sha256(secret, "owner:" + ownerId))}`
 *                     A random id per browser, kept for a year. Every session
 *                     stores the owner_id of the browser that created it.
 *   scopeai_session = `${sessionId}.${base64url(hmac_sha256(secret, sessionId))}`
 *                     Legacy: one cookie for the most recent session. Only
 *                     checked for sessions stored before owner_id existed.
 *
 * Both are HttpOnly, Secure (in production), SameSite=Lax and carry no PII.
 * The HMAC means a client cannot forge a cookie without the server secret;
 * the "owner:" prefix keeps a session cookie from passing as an owner cookie.
 */

export const SESSION_COOKIE_NAME = "scopeai_session";
export const OWNER_COOKIE_NAME = "scopeai_owner";

const COOKIE_TTL_SECONDS = 24 * 60 * 60;
const OWNER_COOKIE_TTL_SECONDS = 365 * 24 * 60 * 60;

function getSecret(): string {
  const env = getServerEnv();
  if (env.SESSION_SECRET) return env.SESSION_SECRET;
  // Dev fallback: a per-process random secret stashed on globalThis so
  // Next.js Fast Refresh module re-evaluation does not rotate it (which
  // would invalidate every prior cookie and 404 the user out). In prod
  // SESSION_SECRET is required.
  if (env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET is required in production. Set a 32+ char secret.");
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

function sign(payload: string): string {
  const mac = createHmac("sha256", getSecret()).update(payload).digest();
  return mac.toString("base64url");
}

/** Constant-time check that `sig` is the signature of `payload`. */
function signatureMatches(payload: string, sig: string): boolean {
  const expected = sign(payload);
  if (sig.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}

/** Split `${id}.${sig}`; null if the shape is wrong. */
function splitSigned(cookieValue: string | undefined): [string, string] | null {
  if (!cookieValue) return null;
  const dot = cookieValue.indexOf(".");
  if (dot <= 0 || dot === cookieValue.length - 1) return null;
  return [cookieValue.slice(0, dot), cookieValue.slice(dot + 1)];
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
  const parts = splitSigned(cookieValue);
  if (!parts || parts[0] !== expectedSessionId) return false;
  return signatureMatches(expectedSessionId, parts[1]);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function newOwnerId(): string {
  return randomUUID();
}

export function buildOwnerCookie(ownerId: string): CookieOptions {
  return {
    name: OWNER_COOKIE_NAME,
    value: `${ownerId}.${sign(`owner:${ownerId}`)}`,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: OWNER_COOKIE_TTL_SECONDS,
  };
}

/** The owner id in a valid owner cookie, or null if missing or forged. */
export function readOwnerCookie(cookieValue: string | undefined): string | null {
  const parts = splitSigned(cookieValue);
  if (!parts || !UUID_RE.test(parts[0])) return null;
  return signatureMatches(`owner:${parts[0]}`, parts[1]) ? parts[0] : null;
}

/** Anything with Next's cookie `get`: request cookies or `await cookies()`. */
interface CookieReader {
  get(name: string): { value: string } | undefined;
}

/**
 * Whether the browser behind `cookies` owns `session`: its owner cookie
 * matches session.owner_id. Sessions stored before owner_id existed (null)
 * fall back to the legacy per-session cookie.
 */
export function ownsSession(
  cookies: CookieReader,
  session: { id: string; owner_id: string | null },
): boolean {
  if (session.owner_id) {
    return readOwnerCookie(cookies.get(OWNER_COOKIE_NAME)?.value) === session.owner_id;
  }
  return verifySessionCookie(cookies.get(SESSION_COOKIE_NAME)?.value, session.id);
}
