import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { markRoundFailed } from "@/lib/pipeline/orchestrator";
import { getSession, putSession } from "@/lib/storage/session";
import { startJobs } from "@/lib/jobs/start";
import { isLlmBudgetExhausted } from "@/lib/llm/budget";
import { BudgetExceededError } from "@/lib/errors";
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
 * Start the initial round (or resume a failed one) after its session has been
 * created and persisted. The round runs as a background job (OPS-01): this
 * answers 202 with the session at once, and the browser follows each pipeline
 * stage the job writes through /events (or by polling).
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
    return await withSessionLock(id, async (lock) => {
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

      if (await isLlmBudgetExhausted()) {
        // Stored like a round that hit the budget, so the chat shows why.
        const err = new BudgetExceededError();
        await putSession(markRoundFailed(session, err));
        throw err;
      }

      const next: Session = {
        ...session,
        status: "analyzing",
        pipeline_stage: "extracting",
        last_error: null,
        updated_at: Date.now(),
      };
      await startJobs({
        lock,
        previous: session,
        next,
        types: ["round"],
        origin: req.nextUrl.origin,
      });
      return NextResponse.json({ session: next }, { status: 202 });
    });
  } catch (err) {
    return jsonError(err);
  }
}
