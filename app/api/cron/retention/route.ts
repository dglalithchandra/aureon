import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getServerEnv } from "@/lib/env";
import { runRetention } from "@/lib/retention/run";
import { jsonError } from "@/lib/security/route-helpers";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The daily retention job (vercel.json schedules it at 03:15 UTC).
 *
 * Vercel signs its cron requests with the project's CRON_SECRET as a bearer
 * token. Without that secret configured the endpoint refuses everything, so
 * a deployment that forgets it fails closed rather than exposing a job that
 * deletes client text.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const secret = getServerEnv().CRON_SECRET;
  const offered = req.headers.get("authorization");
  if (!secret || offered !== `Bearer ${secret}`) {
    logger.warn("cron.unauthorized", { path: "/api/cron/retention" });
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Cron authentication required" } },
      { status: 401 },
    );
  }

  try {
    const result = await runRetention();
    return NextResponse.json(result);
  } catch (err) {
    return jsonError(err, 500, req);
  }
}
