import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { createShareLink, findActiveShare } from "@/lib/storage/share";
import {
  jsonError,
  loadOwnedSession,
  readJsonBody,
  requireJsonContentType,
} from "@/lib/security/route-helpers";
import { deriveTitle } from "@/lib/utils";
import { ValidationError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RequestSchema = z.object({
  sessionId: z.string().uuid(),
  /** The title shown on the output page, which the owner may have edited. */
  title: z.string().max(200).optional(),
});

/**
 * Share a finalized session (BUG-04). Returns the session's active link if
 * it has one; otherwise stores a snapshot of the output (with its own 30-day
 * TTL) under a new token. The share page renders only from the snapshot.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctMismatch = requireJsonContentType(req);
  if (ctMismatch) return ctMismatch;

  try {
    const { sessionId, title } = await readJsonBody(req, RequestSchema);

    const session = await loadOwnedSession(req, sessionId);
    if (session instanceof NextResponse) return session;
    if (session.status !== "finalized" || !session.final_output) {
      throw new ValidationError(
        "Session must be finalized with a generated output before it can be shared.",
      );
    }

    const existing = await findActiveShare(sessionId);
    const share =
      existing ??
      (await createShareLink({
        sessionId,
        owner_id: session.owner_id,
        // Plain text: React escapes it on the share page.
        title: title?.trim().slice(0, 120).trim() || deriveTitle(session.raw_input),
        final_output: session.final_output,
      }));

    return NextResponse.json({
      token: share.token,
      url: `/share/${share.token}`,
      created_at: share.snapshot.created_at,
      reused: existing !== null,
    });
  } catch (err) {
    return jsonError(err);
  }
}
