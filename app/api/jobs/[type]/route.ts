import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { Receiver } from "@upstash/qstash";
import { getServerEnv } from "@/lib/env";
import { runJob } from "@/lib/jobs/run";
import { JobSchema, JobTypeSchema } from "@/lib/jobs/types";
import { jsonError } from "@/lib/security/route-helpers";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ type: string }>;
}

/**
 * Internal: QStash delivers queued pipeline jobs here (OPS-01). Only a
 * request carrying a valid QStash signature over its exact body is run, so
 * nobody else can trigger LLM work through this endpoint. The job runs to
 * completion before the response, within this function's maxDuration.
 */
export async function POST(
  req: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  const { type } = await params;
  const jobType = JobTypeSchema.safeParse(type);
  if (!jobType.success) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Unknown job type" } },
      { status: 404 },
    );
  }

  const body = await req.text();
  if (!(await hasValidSignature(req.headers.get("upstash-signature"), body))) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Invalid signature" } },
      { status: 401 },
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    payload = null;
  }
  const job = JobSchema.safeParse(payload);
  if (!job.success || job.data.type !== jobType.data) {
    // Signed but malformed (or sent to the wrong type): nothing to run.
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid job payload" } },
      { status: 400 },
    );
  }

  try {
    const outcome = await runJob(job.data);
    return NextResponse.json({ outcome });
  } catch (err) {
    // Storage failures and the like: a 5xx lets QStash retry the delivery.
    return jsonError(err, 500, req);
  }
}

async function hasValidSignature(
  signature: string | null,
  body: string,
): Promise<boolean> {
  const env = getServerEnv();
  const currentSigningKey = env.QSTASH_CURRENT_SIGNING_KEY;
  const nextSigningKey = env.QSTASH_NEXT_SIGNING_KEY;
  // Without keys nothing can be verified, so nothing is accepted.
  if (!signature || !currentSigningKey || !nextSigningKey) return false;
  try {
    // devMode: false — only the configured keys are trusted.
    const receiver = new Receiver({ currentSigningKey, nextSigningKey, devMode: false });
    return await receiver.verify({ signature, body, clockTolerance: 5 });
  } catch (err) {
    logger.warn("jobs.signature_rejected", {
      message: err instanceof Error ? err.message : "unknown",
    });
    return false;
  }
}
