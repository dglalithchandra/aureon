import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { resolveShareToken, revokeShareLink } from "@/lib/storage/share";
import { jsonError, requireSessionOwner } from "@/lib/security/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ token: string }>;
}

/**
 * Revoke a share link (owner only). The snapshot is deleted, so the link
 * answers 404 from now on; sharing again creates a new link.
 */
export async function DELETE(
  req: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  const { token } = await params;
  try {
    const snapshot = await resolveShareToken(token);
    if (!snapshot) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Share link not found or expired" } },
        { status: 404 },
      );
    }

    // The snapshot keeps the owner, so this works after the session expired.
    const unauthorized = requireSessionOwner(req, {
      id: snapshot.sessionId,
      owner_id: snapshot.owner_id,
    });
    if (unauthorized) return unauthorized;

    await revokeShareLink(token, snapshot.sessionId);
    return NextResponse.json({ revoked: true });
  } catch (err) {
    return jsonError(err);
  }
}
