import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { FinalizeRequestSchema } from "@/lib/schemas/output";
import { generateOutput } from "@/lib/pipeline/finalize";
import { getSession, putSession } from "@/lib/storage/session";
import {
  gateRateLimit,
  getClientIp,
  jsonError,
  readJsonBody,
  requireJsonContentType,
  requireSessionOwner,
  withSessionLock,
} from "@/lib/security/route-helpers";
import { RATE_LIMITS } from "@/lib/security/rate-limit";
import { ValidationError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctMismatch = requireJsonContentType(req);
  if (ctMismatch) return ctMismatch;

  const ip = getClientIp(req);
  const { limit, windowSeconds } = RATE_LIMITS.llmRoute;
  const limited = await gateRateLimit(`finalize:${ip}`, limit, windowSeconds);
  if (limited) return limited;

  try {
    const { sessionId, override } = await readJsonBody(req, FinalizeRequestSchema);

    const unauthorized = requireSessionOwner(req, sessionId);
    if (unauthorized) return unauthorized;

    return await withSessionLock(sessionId, async () => {
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

      if (session.status !== "ready" && !override) {
        throw new ValidationError(
          `Session status is ${session.status}; finalize requires status=ready or override=true`,
        );
      }

      const output = await generateOutput(session);
      const updated = {
        ...session,
        final_output: output,
        status: "finalized" as const,
        updated_at: Date.now(),
      };
      await putSession(updated);

      return NextResponse.json({ output, cached: false });
    });
  } catch (err) {
    return jsonError(err);
  }
}
