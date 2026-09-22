import "@/lib/server-only";
import { after } from "next/server";
import { Client } from "@upstash/qstash";
import { getServerEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { JOB_MAX_DURATION_SECONDS } from "@/lib/storage/lock";
import { runJob } from "@/lib/jobs/run";
import type { Job } from "@/lib/jobs/types";

/** QStash retries a delivery that failed before the job claimed itself. */
const QSTASH_RETRIES = 3;

let client: Client | null = null;

function getQStash(token: string, baseUrl: string | undefined): Client {
  // devMode: false — never let the SDK download and start its dev server.
  client ??= new Client({ token, baseUrl, devMode: false });
  return client;
}

/**
 * Hand jobs to the queue. With QSTASH_TOKEN set they are published in one
 * batch (so /finalize's two parts are queued together or not at all) to
 * POST {JOBS_BASE_URL or the request origin}/api/jobs/{type}. Otherwise they
 * run in this process after the response is sent (after() — dev only: the
 * work dies with the function instance and is not retried).
 */
export async function sendJobs(jobs: Job[], origin: string): Promise<void> {
  const env = getServerEnv();
  if (!env.QSTASH_TOKEN) {
    for (const job of jobs) {
      after(async () => {
        try {
          await runJob(job);
        } catch (err) {
          logger.error("jobs.inline.failure", {
            type: job.type,
            sessionId: job.sessionId,
            message: err instanceof Error ? err.message : "unknown",
          });
        }
      });
    }
    logger.info("jobs.enqueued", { transport: "after", count: jobs.length });
    return;
  }

  const base = (env.JOBS_BASE_URL ?? origin).replace(/\/+$/, "");
  // Preview deployments sit behind Vercel Deployment Protection; QStash
  // forwards this header so its calls get through.
  const headers: Record<string, string> = env.VERCEL_AUTOMATION_BYPASS_SECRET
    ? { "x-vercel-protection-bypass": env.VERCEL_AUTOMATION_BYPASS_SECRET }
    : {};
  const results = await getQStash(env.QSTASH_TOKEN, env.QSTASH_URL).batchJSON(
    jobs.map((job) => ({
      url: `${base}/api/jobs/${job.type}`,
      body: job,
      headers,
      retries: QSTASH_RETRIES,
      timeout: JOB_MAX_DURATION_SECONDS,
      deduplicationId: `${job.lockToken}-${job.type}`,
    })),
  );
  logger.info("jobs.enqueued", {
    transport: "qstash",
    count: jobs.length,
    messageIds: results.map((r) => r.messageId),
  });
}
