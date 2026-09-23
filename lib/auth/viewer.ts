import "@/lib/server-only";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { getDatabase } from "@/lib/db/client";
import { auditLog, authSessions, projects, users } from "@/lib/db/schema";
import { OWNER_COOKIE_NAME, readOwnerCookie } from "@/lib/security/session-cookie";
import { logger } from "@/lib/logger";

/**
 * Who is asking.
 *
 * A viewer can be signed in, anonymous, or both at once — the browser keeps
 * its anonymous owner id after sign-in, which is how a scope started before
 * signing in gets claimed by the account that follows.
 *
 * The signed-in user is resolved straight from the request's Auth.js session
 * cookie against `auth_sessions`, not through `auth()`. Two reasons: a route
 * handler then needs nothing from `next/headers`, and the tests can hand a
 * cookie to a handler they call directly.
 */

export interface Viewer {
  userId: string | null;
  email: string | null;
  /** The browser's anonymous owner id (BUG-03), when it has one. */
  anonId: string | null;
}

export const ANONYMOUS: Viewer = { userId: null, email: null, anonId: null };

/** Auth.js names its cookie with a `__Secure-` prefix over HTTPS. */
const SESSION_COOKIE_NAMES = ["authjs.session-token", "__Secure-authjs.session-token"];

function sessionTokenOf(req: NextRequest): string | null {
  for (const name of SESSION_COOKIE_NAMES) {
    const value = req.cookies.get(name)?.value;
    if (value) return value;
  }
  return null;
}

/**
 * The viewer behind a request. Also claims anonymous projects for a signed-in
 * browser, which is cheap (one indexed update, and only while the anonymous
 * cookie is still present) and idempotent.
 */
export async function getViewer(req: NextRequest): Promise<Viewer> {
  const anonId = readOwnerCookie(req.cookies.get(OWNER_COOKIE_NAME)?.value);
  const token = sessionTokenOf(req);
  if (!token) return { userId: null, email: null, anonId };

  const db = getDatabase();
  try {
    const [row] = await db
      .select({ userId: users.id, email: users.email })
      .from(authSessions)
      .innerJoin(users, eq(users.id, authSessions.userId))
      .where(
        and(eq(authSessions.sessionToken, token), gt(authSessions.expires, new Date())),
      )
      .limit(1);
    if (!row) return { userId: null, email: null, anonId };
    if (anonId) await claimAnonymousProjects(row.userId, anonId);
    return { userId: row.userId, email: row.email, anonId };
  } catch (err) {
    // A database blip must not turn a signed-in user into someone else's
    // viewer: fail closed to anonymous, which can only see less.
    logger.warn("viewer.lookup_failure", {
      message: err instanceof Error ? err.message : "unknown",
    });
    return { userId: null, email: null, anonId };
  }
}

/**
 * Hand every unclaimed project of this browser to the account that just
 * signed in. Projects already owned by someone are never touched.
 */
export async function claimAnonymousProjects(
  userId: string,
  anonId: string,
): Promise<number> {
  const db = getDatabase();
  const claimed = await db
    .update(projects)
    .set({ userId })
    .where(and(eq(projects.anonOwnerId, anonId), isNull(projects.userId)))
    .returning({ id: projects.id });

  if (claimed.length > 0) {
    logger.info("auth.projects_claimed", { userId, count: claimed.length });
    await db.insert(auditLog).values(
      claimed.map((project) => ({
        action: "project.claimed",
        actorUserId: userId,
        actorAnonId: anonId,
        subjectType: "project",
        subjectId: project.id,
      })),
    );
  }
  return claimed.length;
}

export function isSignedIn(viewer: Viewer): boolean {
  return viewer.userId !== null;
}

/**
 * The viewer inside a server component, where there is no NextRequest. Reads
 * the same two cookies through next/headers and runs the same claim.
 */
export async function getViewerFromCookies(): Promise<Viewer> {
  const { cookies } = await import("next/headers");
  const jar = await cookies();
  const anonId = readOwnerCookie(jar.get(OWNER_COOKIE_NAME)?.value);
  const token = SESSION_COOKIE_NAMES.map((name) => jar.get(name)?.value).find(Boolean);
  if (!token) return { userId: null, email: null, anonId };

  const db = getDatabase();
  try {
    const [row] = await db
      .select({ userId: users.id, email: users.email })
      .from(authSessions)
      .innerJoin(users, eq(users.id, authSessions.userId))
      .where(
        and(eq(authSessions.sessionToken, token), gt(authSessions.expires, new Date())),
      )
      .limit(1);
    if (!row) return { userId: null, email: null, anonId };
    if (anonId) await claimAnonymousProjects(row.userId, anonId);
    return { userId: row.userId, email: row.email, anonId };
  } catch {
    return { userId: null, email: null, anonId };
  }
}
