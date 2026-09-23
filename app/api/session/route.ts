import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { CreateSessionRequestSchema } from "@/lib/schemas/mcq";
import { anonymousProjectCount } from "@/lib/auth/access";
import { getViewer } from "@/lib/auth/viewer";
import { assignProject, ensurePersonalWorkspace } from "@/lib/auth/workspace";
import { SignInRequiredError } from "@/lib/errors";
import { createSession } from "@/lib/pipeline/orchestrator";
import { putSession } from "@/lib/storage/session";
import {
  newOwnerId,
  OWNER_COOKIE_NAME,
  readOwnerCookie,
} from "@/lib/security/session-cookie";
import {
  attachOwnerCookie,
  jsonError,
  readJsonBody,
  requireJsonContentType,
} from "@/lib/security/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** How many scopes a browser may keep without an account. */
const ANONYMOUS_PROJECT_LIMIT = 1;

/**
 * Create a session owned by this browser (BUG-03), or by the signed-in user
 * when there is one. The browser's owner cookie is reused, so creating a new
 * session never locks it out of the earlier ones; the cookie is only set
 * when it is missing or invalid.
 *
 * Signed out, a browser may keep one scope: the second attempt asks for an
 * account rather than quietly filling a database with orphans.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctMismatch = requireJsonContentType(req);
  if (ctMismatch) return ctMismatch;

  try {
    const { rawText } = await readJsonBody(req, CreateSessionRequestSchema);
    const existingOwner = readOwnerCookie(req.cookies.get(OWNER_COOKIE_NAME)?.value);
    const ownerId = existingOwner ?? newOwnerId();
    const viewer = await getViewer(req);

    if (!viewer.userId && existingOwner) {
      const existing = await anonymousProjectCount(existingOwner);
      if (existing >= ANONYMOUS_PROJECT_LIMIT) throw new SignInRequiredError();
    }

    const session = createSession(rawText, ownerId);
    await putSession(session);
    if (viewer.userId) {
      // A signed-in scope belongs to the account and its personal workspace
      // from the start, so it shows up on every device immediately.
      await ensurePersonalWorkspace(viewer.userId).then((workspaceId) =>
        assignProject(session.id, viewer.userId!, workspaceId),
      );
    }
    const res = NextResponse.json({ session });
    return existingOwner ? res : attachOwnerCookie(res, ownerId);
  } catch (err) {
    return jsonError(err);
  }
}
