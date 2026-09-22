import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SubmitAnswersRequestSchema } from "@/lib/schemas/mcq";
import { submitAnswers } from "@/lib/pipeline/orchestrator";
import { getSession, putSession } from "@/lib/storage/session";
import {
  gateRateLimit,
  getClientIp,
  jsonError,
  readJsonBody,
  requireJsonContentType,
  requireSessionOwner,
  validateUuid,
} from "@/lib/security/route-helpers";
import { RATE_LIMITS } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

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
    const session = await getSession(id);
    if (!session) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Session not found or expired" } },
        { status: 404 },
      );
    }
    const updated = await submitAnswers(session, answers, putSession);
    await putSession(updated);
    return NextResponse.json({ session: updated });
  } catch (err) {
    return jsonError(err);
  }
}
