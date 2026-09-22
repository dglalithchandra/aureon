import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { CreateSessionRequestSchema } from "@/lib/schemas/mcq";
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

/**
 * Create a session owned by this browser (BUG-03). The browser's owner
 * cookie is reused, so creating a new session never locks it out of the
 * earlier ones; the cookie is only set when it is missing or invalid.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctMismatch = requireJsonContentType(req);
  if (ctMismatch) return ctMismatch;

  try {
    const { rawText } = await readJsonBody(req, CreateSessionRequestSchema);
    const existingOwner = readOwnerCookie(req.cookies.get(OWNER_COOKIE_NAME)?.value);
    const ownerId = existingOwner ?? newOwnerId();
    const session = createSession(rawText, ownerId);
    await putSession(session);
    const res = NextResponse.json({ session });
    return existingOwner ? res : attachOwnerCookie(res, ownerId);
  } catch (err) {
    return jsonError(err);
  }
}
