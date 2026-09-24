import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { resolveShareToken } from "@/lib/storage/share";
import { recordDecision } from "@/lib/versions/approval";
import { getClientIp, jsonError, readJsonBody } from "@/lib/security/route-helpers";
import { ValidationError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DecisionSchema = z.object({
  decision: z.enum(["approved", "changes_requested"]),
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(200).optional().or(z.literal("")),
  comment: z.string().trim().max(2000).optional(),
});

/**
 * The client's decision on an approval link (blueprint step 13).
 *
 * No account: the link is the authorisation, and it only authorises this —
 * a row in `approvals` and, for an approval, the lock on that version.
 * Nothing here can change the scope itself; the document the client saw is
 * the snapshot stored with the link.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await ctx.params;

  try {
    const snapshot = await resolveShareToken(token);
    if (!snapshot) {
      return NextResponse.json(
        {
          error: { code: "NOT_FOUND", message: "This link has expired or been revoked" },
        },
        { status: 404 },
      );
    }
    if (snapshot.mode !== "approval") {
      throw new ValidationError("This link is read-only, not an approval link.");
    }

    const body = await readJsonBody(req, DecisionSchema);
    const result = await recordDecision({
      projectId: snapshot.sessionId,
      versionId: snapshot.version_id,
      versionNumber: snapshot.version_number,
      shareToken: token,
      decision: body.decision,
      name: body.name,
      email: body.email || null,
      comment: body.comment ?? null,
      ip: getClientIp(req),
    });

    return NextResponse.json({
      state: result.state,
      version: result.version
        ? { number: result.version.versionNumber, label: result.version.label }
        : null,
    });
  } catch (err) {
    return jsonError(err, 500, req);
  }
}
