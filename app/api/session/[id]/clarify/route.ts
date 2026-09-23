import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { ClarifyRequestSchema } from "@/lib/schemas/mcq";
import { applyClarification, markRoundFailed } from "@/lib/pipeline/orchestrator";
import { getSession, putSession } from "@/lib/storage/session";
import { startJobs } from "@/lib/jobs/start";
import { isLlmBudgetExhausted } from "@/lib/llm/budget";
import { BudgetExceededError } from "@/lib/errors";
import {
  gateRateLimit,
  getClientIp,
  jsonError,
  loadOwnedSession,
  readJsonBody,
  requireJsonContentType,
  validateUuid,
  withSessionLock,
} from "@/lib/security/route-helpers";
import { RATE_LIMITS } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * Answer one open item from the output page (UX-02).
 *
 * The answer is recorded on the latest round and the next round is queued,
 * exactly as /describe does for a stuck session — a finished scope goes back
 * to "analyzing" and comes out regenerated. The caller finalizes again once
 * the round settles, which writes the new version (blueprint step 14).
 */
export async function POST(
  req: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  const ctMismatch = requireJsonContentType(req);
  if (ctMismatch) return ctMismatch;

  const { id } = await params;
  if (!validateUuid(id)) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid session id" } },
      { status: 400 },
    );
  }

  const ip = getClientIp(req);
  const { limit, windowSeconds } = RATE_LIMITS.llmRoute;
  const limited = await gateRateLimit(`clarify:${ip}`, limit, windowSeconds);
  if (limited) return limited;

  try {
    // Ownership is checked before the lock, so a stranger cannot hold it.
    const owned = await loadOwnedSession(req, id);
    if (owned instanceof NextResponse) return owned;

    const { question, answer } = await readJsonBody(req, ClarifyRequestSchema);
    return await withSessionLock(id, async (lock) => {
      const session = await getSession(id);
      if (!session) {
        return NextResponse.json(
          { error: { code: "NOT_FOUND", message: "Session not found or expired" } },
          { status: 404 },
        );
      }
      const next = applyClarification(session, question, answer);

      if (await isLlmBudgetExhausted()) {
        // Keep the answer, stored like a round that hit the budget.
        const err = new BudgetExceededError();
        await putSession(markRoundFailed(next, err));
        throw err;
      }

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
