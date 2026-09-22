import "@/lib/server-only";
import { putSession } from "@/lib/storage/session";
import { sendJobs } from "@/lib/jobs/transport";
import type { JobType } from "@/lib/jobs/types";
import type { SessionLock } from "@/lib/security/route-helpers";
import type { Session } from "@/lib/schemas/mcq";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";

interface StartJobsInput {
  /** The session lock the route holds; handed to the jobs once they are queued. */
  lock: SessionLock;
  /** The stored session before this request, restored if queueing fails. */
  previous: Session;
  /** The session to store before the jobs start (e.g. status "analyzing"). */
  next: Session;
  types: JobType[];
  /** Origin of the incoming request, the default base URL for QStash. */
  origin: string;
}

/**
 * Store `next`, queue its jobs and hand the session lock to them (OPS-01).
 * The session is stored first so a job never reads the state from before
 * this request. If the queue refuses the jobs, `previous` is restored, the
 * lock stays with the route (which releases it) and a 503 is thrown.
 */
export async function startJobs(input: StartJobsInput): Promise<void> {
  const { lock, previous, next, types, origin } = input;
  await putSession(next);
  try {
    await sendJobs(
      types.map((type) => ({ type, sessionId: next.id, lockToken: lock.token })),
      origin,
    );
  } catch (err) {
    logger.error("jobs.enqueue_failure", {
      sessionId: next.id,
      types,
      message: err instanceof Error ? err.message : "unknown",
    });
    await putSession(previous).catch(() => undefined);
    throw new AppError(
      "INTERNAL_ERROR",
      "Could not start the work right now. Please try again.",
      503,
    );
  }
  lock.handOff();
}
