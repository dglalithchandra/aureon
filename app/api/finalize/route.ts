import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { FinalizeRequestSchema } from "@/lib/schemas/output";
import type { OutputPart, Session } from "@/lib/schemas/mcq";
import { getSession, putSession } from "@/lib/storage/session";
import { startJobs } from "@/lib/jobs/start";
import { isLlmBudgetExhausted } from "@/lib/llm/budget";
import {
  gateRateLimit,
  getClientIp,
  jsonError,
  loadOwnedSession,
  readJsonBody,
  requireJsonContentType,
  withSessionLock,
} from "@/lib/security/route-helpers";
import { RATE_LIMITS } from "@/lib/security/rate-limit";
import { BlockedError, BudgetExceededError, ValidationError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OUTPUT_PARTS: readonly OutputPart[] = ["client", "engineer"];

/**
 * Queue the client and engineer views as two background jobs (OPS-01) and
 * answer 202 with the session. Each view is saved to draft_output as soon as
 * it lands; the job that finishes last stores final_output. After a failure,
 * calling this again only regenerates the view that is still missing.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctMismatch = requireJsonContentType(req);
  if (ctMismatch) return ctMismatch;

  const ip = getClientIp(req);
  const { limit, windowSeconds } = RATE_LIMITS.llmRoute;
  const limited = await gateRateLimit(`finalize:${ip}`, limit, windowSeconds);
  if (limited) return limited;

  try {
    const { sessionId, override } = await readJsonBody(req, FinalizeRequestSchema);

    // Ownership is checked before the lock, so a stranger cannot hold it.
    const owned = await loadOwnedSession(req, sessionId);
    if (owned instanceof NextResponse) return owned;

    return await withSessionLock(sessionId, async (lock) => {
      const session = await getSession(sessionId);
      if (!session) {
        return NextResponse.json(
          { error: { code: "NOT_FOUND", message: "Session not found or expired" } },
          { status: 404 },
        );
      }

      // Idempotent fast-path: already finalized.
      if (session.status === "finalized" && session.final_output) {
        return NextResponse.json({ output: session.final_output, cached: true });
      }

      // No scope while the goal or core features are missing (BUG-05).
      const latest = session.rounds[session.rounds.length - 1];
      if (latest?.extraction.blocker && !override) {
        throw new BlockedError();
      }

      if (session.status !== "ready" && !override) {
        throw new ValidationError(
          `Session status is ${session.status}; finalize requires status=ready or override=true`,
        );
      }
      if (session.rounds.length === 0) {
        throw new ValidationError("Session has no rounds to finalize");
      }

      const draft = session.draft_output;
      if (draft?.client && draft.engineer) {
        // Both views already landed; only the final write was missing.
        const output = { client: draft.client, engineer: draft.engineer };
        await putSession(finalized(session, output));
        return NextResponse.json({ output, cached: true });
      }

      if (await isLlmBudgetExhausted()) throw new BudgetExceededError();

      const missing = OUTPUT_PARTS.filter((part) => !draft?.[part]);
      const next: Session = {
        ...session,
        pipeline_stage: "finalizing",
        last_error: null,
        draft_output: {
          client: draft?.client ?? null,
          engineer: draft?.engineer ?? null,
          pending: missing,
        },
        updated_at: Date.now(),
      };
      await startJobs({
        lock,
        previous: session,
        next,
        types: missing.map((part) => `finalize-${part}` as const),
        origin: req.nextUrl.origin,
      });
      return NextResponse.json({ session: next }, { status: 202 });
    });
  } catch (err) {
    return jsonError(err);
  }
}

function finalized(
  session: Session,
  output: NonNullable<Session["final_output"]>,
): Session {
  return {
    ...session,
    status: "finalized",
    final_output: output,
    draft_output: null,
    pipeline_stage: null,
    last_error: null,
    updated_at: Date.now(),
  };
}
