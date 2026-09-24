import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { DescribeRequestSchema } from "@/lib/schemas/mcq";
import { applyDescription, markRoundFailed } from "@/lib/pipeline/orchestrator";
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
 * The fuller description asked for while the session is "needs_input"
 * (BUG-05). Records it and queues the next round, which re-extracts from the
 * old text plus this one; answers 202 with the "analyzing" session at once.
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
  const limited = await gateRateLimit(`describe:${ip}`, limit, windowSeconds);
  if (limited) return limited;

  try {
    // Ownership is checked before the lock, so a stranger cannot hold it.
    const owned = await loadOwnedSession(req, id);
    if (owned instanceof NextResponse) return owned;

    const { text } = await readJsonBody(req, DescribeRequestSchema);
    return await withSessionLock(id, async (lock) => {
      const session = await getSession(id);
      if (!session) {
        return NextResponse.json(
          { error: { code: "NOT_FOUND", message: "Session not found or expired" } },
          { status: 404 },
        );
      }
      const next = applyDescription(session, text);

      if (await isLlmBudgetExhausted()) {
        // Keep the description, stored like a round that hit the budget.
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
    return jsonError(err, 500, req);
  }
}
