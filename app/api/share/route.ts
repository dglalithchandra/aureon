import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { createShareLink, findActiveShare, listShares } from "@/lib/storage/share";
import { latestVersion } from "@/lib/versions/store";
import { SHARE_MODES } from "@/lib/db/schema";
import {
  jsonError,
  loadOwnedSession,
  readJsonBody,
  requireJsonContentType,
  validateUuid,
} from "@/lib/security/route-helpers";
import { deriveTitle } from "@/lib/utils";
import { ValidationError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RequestSchema = z.object({
  sessionId: z.string().uuid(),
  /** The title shown on the output page, which the owner may have edited. */
  title: z.string().max(200).optional(),
  /** "approval" asks the client to approve the version (step 13). */
  mode: z.enum(SHARE_MODES).default("view"),
  /** 7, 30 or 90 days. */
  expiresInDays: z.union([z.literal(7), z.literal(30), z.literal(90)]).default(30),
  /** Force a new link even when one is active (a fresh expiry, say). */
  fresh: z.boolean().default(false),
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
    const { sessionId, title, mode, expiresInDays, fresh } = await readJsonBody(
      req,
      RequestSchema,
    );

    const session = await loadOwnedSession(req, sessionId);
    if (session instanceof NextResponse) return session;
    if (session.status !== "finalized" || !session.final_output) {
      throw new ValidationError(
        "Session must be finalized with a generated output before it can be shared.",
      );
    }

    // An approval link always points at a particular version, so the
    // decision can name what was approved. A read-only link reuses whatever
    // is already live, as it always has.
    const version = mode === "approval" ? await latestVersion(sessionId) : null;
    if (mode === "approval" && !version) {
      throw new ValidationError(
        "This scope has no saved version yet. Generate the output first.",
      );
    }

    const existing = mode === "view" && !fresh ? await findActiveShare(sessionId) : null;
    const share =
      existing ??
      (await createShareLink({
        sessionId,
        owner_id: session.owner_id,
        // Plain text: React escapes it on the share page.
        title: title?.trim().slice(0, 120).trim() || deriveTitle(session.raw_input),
        final_output: session.final_output,
        mode,
        version_id: version?.id ?? null,
        version_number: version?.versionNumber ?? null,
        expires_in_days: expiresInDays,
      }));

    return NextResponse.json({
      token: share.token,
      url: `/share/${share.token}`,
      created_at: share.snapshot.created_at,
      expires_at: share.snapshot.expires_at,
      mode: share.snapshot.mode,
      version_number: share.snapshot.version_number,
      reused: existing !== null,
    });
  } catch (err) {
    return jsonError(err);
  }
}

/** Every live link of a project, for share management (step 13). */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const sessionId = req.nextUrl.searchParams.get("sessionId") ?? "";
  if (!validateUuid(sessionId)) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid session id" } },
      { status: 400 },
    );
  }
  try {
    const session = await loadOwnedSession(req, sessionId);
    if (session instanceof NextResponse) return session;
    const links = await listShares(sessionId);
    return NextResponse.json({
      shares: links.map((link) => ({
        token: link.token,
        url: `/share/${link.token}`,
        mode: link.snapshot.mode,
        version_number: link.snapshot.version_number,
        created_at: link.snapshot.created_at,
        expires_at: link.snapshot.expires_at,
        active: link.active,
      })),
    });
  } catch (err) {
    return jsonError(err);
  }
}
