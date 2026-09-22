import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { CreateSessionRequestSchema } from "@/lib/schemas/mcq";
import { createSession } from "@/lib/pipeline/orchestrator";
import { putSession } from "@/lib/storage/session";
import {
  attachSessionCookie,
  jsonError,
  readJsonBody,
  requireJsonContentType,
} from "@/lib/security/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctMismatch = requireJsonContentType(req);
  if (ctMismatch) return ctMismatch;

  try {
    const { rawText } = await readJsonBody(req, CreateSessionRequestSchema);
    const session = createSession(rawText);
    await putSession(session);
    const res = NextResponse.json({ session });
    return attachSessionCookie(res, session);
  } catch (err) {
    return jsonError(err);
  }
}
