import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { runRound } from "@/lib/pipeline/orchestrator";
import { getSession, putSession } from "@/lib/storage/session";
import {
  gateRateLimit,
  getClientIp,
  inProgressResponse,
  jsonError,
  requireSessionOwner,
  validateUuid,
  withSessionLock,
} from "@/lib/security/route-helpers";
import type { Session } from "@/lib/schemas/mcq";
import { RATE_LIMITS } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/** An "analyzing" session with no progress for this long is treated as stuck. */
const STALE_ANALYZING_MS = 120_000;

/**
 * What /run should do with the stored session (the caller holds its lock):
 *   - "error" → resume from enriched_input (Retry after a failed round).
 *   - "analyzing", never started (updated_at === created_at) → normal start.
 *   - "analyzing", no progress for STALE_ANALYZING_MS → the request running it
 *     died (e.g. a platform timeout) → resume.
 *   - "analyzing", recently active → another instance may still be on it → busy.
 *   - anything else → nothing to run; return it unchanged.
 */
function runDecision(session: Session, now: number): "run" | "busy" | "unchanged" {
  if (session.status === "error") return "run";
  if (session.status !== "analyzing") return "unchanged";
  if (session.updated_at === session.created_at) return "run";
  return now - session.updated_at > STALE_ANALYZING_MS ? "run" : "busy";
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
  const { limit, windowSeconds } = RATE_LIMITS.llmRoute;
  const limited = await gateRateLimit(`session-run:${ip}`, limit, windowSeconds);
  if (limited) return limited;

  const unauthorized = requireSessionOwner(req, id);
  if (unauthorized) return unauthorized;

  try {
    // The lock makes a concurrent duplicate /run answer 409 instead of
    // starting a second LLM pipeline for the same session.
    return await withSessionLock(id, async () => {
      const session = await getSession(id);
      if (!session) {
        return NextResponse.json(
          { error: { code: "NOT_FOUND", message: "Session not found or expired" } },
          { status: 404 },
        );
      }

      const decision = runDecision(session, Date.now());
      // A completed round is safe to return unchanged: a duplicate request
      // that arrives after the first finished does not trigger an LLM call.
      if (decision === "unchanged") return NextResponse.json({ session });
      if (decision === "busy") return inProgressResponse(session);

      const updated = await runRound(session, putSession);
      await putSession(updated);
      return NextResponse.json({ session: updated });
    });
  } catch (err) {
    return jsonError(err);
  }
}
