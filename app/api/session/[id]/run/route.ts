import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { runRound } from "@/lib/pipeline/orchestrator";
import { getSession, putSession } from "@/lib/storage/session";
import {
  gateRateLimit,
  getClientIp,
  jsonError,
  requireSessionOwner,
  validateUuid,
} from "@/lib/security/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * Execute the initial round after its session has been created and persisted.
 * The browser can therefore poll the owned session while each real pipeline
 * stage is written by `runRound`.
 */
export async function POST(
  req: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  const { id } = await params;
  if (!validateUuid(id)) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid session id" } },
      { status: 400 },
    );
  }

  const ip = getClientIp(req);
  const limited = await gateRateLimit(`session-run:${ip}`);
  if (limited) return limited;

  const unauthorized = requireSessionOwner(req, id);
  if (unauthorized) return unauthorized;

  try {
    const session = await getSession(id);
    if (!session) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Session not found or expired" } },
        { status: 404 },
      );
    }

    // A completed session is safe to return unchanged; this protects against
    // a duplicate browser request accidentally triggering an extra LLM call.
    if (session.status !== "analyzing") {
      return NextResponse.json({ session });
    }

    const updated = await runRound(session, putSession);
    await putSession(updated);
    return NextResponse.json({ session: updated });
  } catch (err) {
    return jsonError(err);
  }
}
