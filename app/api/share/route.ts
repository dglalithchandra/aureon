import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/storage/session";
import { createShareLink } from "@/lib/storage/share";
import {
  jsonError,
  readJsonBody,
  requireJsonContentType,
  requireSessionOwner,
} from "@/lib/security/route-helpers";
import { ValidationError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RequestSchema = z.object({
  sessionId: z.string().uuid(),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctMismatch = requireJsonContentType(req);
  if (ctMismatch) return ctMismatch;

  try {
    const { sessionId } = await readJsonBody(req, RequestSchema);

    const unauthorized = requireSessionOwner(req, sessionId);
    if (unauthorized) return unauthorized;

    const session = await getSession(sessionId);
    if (!session) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Session not found or expired" } },
        { status: 404 },
      );
    }
    if (session.status !== "finalized" || !session.final_output) {
      throw new ValidationError(
        "Session must be finalized with a generated output before it can be shared.",
      );
    }

    const token = await createShareLink(sessionId);
    return NextResponse.json({ token, url: `/share/${token}` });
  } catch (err) {
    return jsonError(err);
  }
}
