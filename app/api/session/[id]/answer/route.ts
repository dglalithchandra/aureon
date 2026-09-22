import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SubmitAnswersRequestSchema } from "@/lib/schemas/mcq";
import { applyAnswers, markRoundFailed } from "@/lib/pipeline/orchestrator";
import { getSession, putSession } from "@/lib/storage/session";
import { startJobs } from "@/lib/jobs/start";
import { isLlmBudgetExhausted } from "@/lib/llm/budget";
import { BudgetExceededError } from "@/lib/errors";
import {
  gateRateLimit,
  getClientIp,
  jsonError,
  readJsonBody,
  requireJsonContentType,
  requireSessionOwner,
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
 * Record the answers and queue the next round as a background job (OPS-01):
 * answers 202 with the "analyzing" session at once.
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
  const limited = await gateRateLimit(`answer:${ip}`, limit, windowSeconds);
  if (limited) return limited;

  const unauthorized = requireSessionOwner(req, id);
  if (unauthorized) return unauthorized;

  try {
    const { answers } = await readJsonBody(req, SubmitAnswersRequestSchema);
    return await withSessionLock(id, async (lock) => {
      const session = await getSession(id);
      if (!session) {
        return NextResponse.json(
          { error: { code: "NOT_FOUND", message: "Session not found or expired" } },
          { status: 404 },
        );
      }
      const next = applyAnswers(session, answers);
      // Ready or finalized: nothing left to run.
      if (next === session) return NextResponse.json({ session });

      if (await isLlmBudgetExhausted()) {
        // Keep the answers, stored like a round that hit the budget.
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
