import "@/lib/server-only";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { z } from "zod";
import { AppError, serializeError, ValidationError } from "@/lib/errors";
import { checkRateLimit } from "@/lib/security/rate-limit";
import {
  buildSessionCookie,
  SESSION_COOKIE_NAME,
  verifySessionCookie,
} from "@/lib/security/session-cookie";
import type { Session } from "@/lib/schemas/mcq";
import { logger } from "@/lib/logger";
import { getSession } from "@/lib/storage/session";
import {
  acquireLock,
  releaseLock,
  SESSION_LOCK_TTL_SECONDS,
  sessionLockKey,
} from "@/lib/storage/lock";

export { getClientIp } from "@/lib/security/client-ip";

export async function gateRateLimit(
  bucketKey: string,
  limit: number,
  windowSeconds: number,
): Promise<NextResponse | null> {
  const rate = await checkRateLimit(bucketKey, limit, windowSeconds);
  if (rate.success) return null;
  return NextResponse.json(
    { error: { code: "RATE_LIMITED", message: "Too many requests" } },
    {
      status: 429,
      headers: {
        "Retry-After": String(Math.ceil((rate.reset - Date.now()) / 1000)),
      },
    },
  );
}

/**
 * Reject any request whose Content-Type is not application/json. Returns
 * a 415 NextResponse on rejection; callers should `if (r) return r;`.
 *
 * Defense-in-depth — Next will already 400 on a body that isn't JSON, but
 * an explicit 415 makes misuse obvious to API clients and prevents silent
 * coercion via form-encoded bodies.
 */
export function requireJsonContentType(req: NextRequest): NextResponse | null {
  const ct = req.headers.get("content-type")?.toLowerCase() ?? "";
  if (ct.includes("application/json")) return null;
  return NextResponse.json(
    {
      error: {
        code: "VALIDATION_ERROR",
        message: "Expected Content-Type: application/json",
      },
    },
    { status: 415 },
  );
}

export async function readJsonBody<T>(
  req: NextRequest,
  schema: z.ZodType<T>,
): Promise<T> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new ValidationError("Invalid JSON body");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new ValidationError(message);
  }
  return parsed.data;
}

export function jsonError(err: unknown, fallbackStatus = 500): NextResponse {
  if (err instanceof AppError) {
    return NextResponse.json(serializeError(err), { status: err.statusCode });
  }
  logger.error("route.unhandled", {
    message: err instanceof Error ? err.message : "unknown",
  });
  return NextResponse.json(serializeError(err), { status: fallbackStatus });
}

export function attachSessionCookie(res: NextResponse, session: Session): NextResponse {
  const cookie = buildSessionCookie(session.id);
  res.cookies.set(cookie.name, cookie.value, {
    httpOnly: cookie.httpOnly,
    secure: cookie.secure,
    sameSite: cookie.sameSite,
    path: cookie.path,
    maxAge: cookie.maxAge,
  });
  return res;
}

export function requireSessionOwner(
  req: NextRequest,
  sessionId: string,
): NextResponse | null {
  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!verifySessionCookie(cookie, sessionId)) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Session ownership required" } },
      { status: 401 },
    );
  }
  return null;
}

/**
 * 409 for a session another request is already working on. Carries the
 * current session so the client can keep polling instead of showing an error.
 */
export function inProgressResponse(session: Session | null): NextResponse {
  return NextResponse.json(
    {
      error: { code: "IN_PROGRESS", message: "Already working on this session." },
      session,
    },
    { status: 409 },
  );
}

/**
 * Run `work` while holding the session's single-flight lock (BUG-08). The
 * lock is taken before `work` reads the session and always released after.
 * If another request holds it, answers 409 IN_PROGRESS without running `work`.
 */
export async function withSessionLock(
  sessionId: string,
  work: () => Promise<NextResponse>,
): Promise<NextResponse> {
  const key = sessionLockKey(sessionId);
  const token = await acquireLock(key, SESSION_LOCK_TTL_SECONDS);
  if (!token) return inProgressResponse(await getSession(sessionId));
  try {
    return await work();
  } finally {
    // A failed release is not fatal: the lock expires after its TTL.
    await releaseLock(key, token).catch((err: unknown) => {
      logger.warn("session_lock.release_failure", {
        sessionId,
        message: err instanceof Error ? err.message : "unknown",
      });
    });
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateUuid(id: string): boolean {
  return UUID_RE.test(id);
}
