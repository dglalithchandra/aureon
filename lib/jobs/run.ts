import "@/lib/server-only";
import { runRound } from "@/lib/pipeline/orchestrator";
import { generateClientView, generateEngineerView } from "@/lib/pipeline/finalize";
import { getSession, mutateSession, putSession } from "@/lib/storage/session";
import {
  acquireLock,
  ownsLock,
  releaseLock,
  SESSION_LOCK_TTL_SECONDS,
  sessionLockKey,
} from "@/lib/storage/lock";
import type { DraftOutput, OutputPart, Session } from "@/lib/schemas/mcq";
import type { ClientView, EngineerView } from "@/lib/schemas/output";
import { AppError, BudgetExceededError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { Job, JobOutcome } from "@/lib/jobs/types";

/**
 * Run one queued job. Called by POST /api/jobs/[type] (QStash) or in-process
 * through after() when QStash is not configured.
 *
 * QStash delivers at least once, so a job first claims itself: a second
 * delivery of the same job is skipped. A job whose lock token no longer owns
 * the session lock (it expired and someone else took over) is skipped too.
 */
export async function runJob(job: Job): Promise<JobOutcome> {
  const t0 = Date.now();
  const claim = await acquireLock(
    `lock:job:${job.lockToken}:${job.type}`,
    SESSION_LOCK_TTL_SECONDS,
  );
  let outcome: JobOutcome;
  if (!claim) {
    outcome = "duplicate";
  } else if (!(await ownsLock(sessionLockKey(job.sessionId), job.lockToken))) {
    outcome = "stale";
  } else if (job.type === "round") {
    outcome = await runRoundJob(job);
  } else {
    outcome = await runFinalizePartJob(
      job,
      job.type === "finalize-client" ? "client" : "engineer",
    );
  }
  logger.info("jobs.completed", {
    type: job.type,
    sessionId: job.sessionId,
    outcome,
    durationMs: Date.now() - t0,
  });
  return outcome;
}

/**
 * One scoping round. runRound persists every pipeline_stage as it goes and,
 * on failure, the "error" session with last_error — exactly as the routes
 * did before the work moved into a job.
 */
async function runRoundJob(job: Job): Promise<JobOutcome> {
  try {
    const session = await getSession(job.sessionId);
    if (!session) return "not_found";
    const updated = await runRound(session, putSession);
    await putSession(updated);
    return "completed";
  } catch (err) {
    // runRound already stored the failed session for the client to show.
    logger.warn("jobs.round.failed", {
      sessionId: job.sessionId,
      message: err instanceof Error ? err.message : "unknown",
    });
    return "failed";
  } finally {
    await releaseSessionLock(job);
  }
}

/** A finished finalize part: its view, or why it failed. */
type FinalizePartResult =
  | { part: "client"; view: ClientView }
  | { part: "engineer"; view: EngineerView }
  | { part: OutputPart; error: unknown };

/**
 * One half of the final output. The view is saved to draft_output as soon as
 * it lands, so the output page can show it while the other half is still
 * being written. The job that finishes last composes final_output and
 * releases the session lock.
 */
async function runFinalizePartJob(job: Job, part: OutputPart): Promise<JobOutcome> {
  let stored: Session | null = null;
  try {
    const session = await getSession(job.sessionId);
    if (!session) return "not_found";
    const result = await generatePart(session, part);
    stored = await mutateSession(job.sessionId, (current) =>
      applyFinalizePart(current, result),
    );
    if (!stored) return "not_found";
    if ("error" in result) return "failed";
    return (stored.draft_output?.pending.length ?? 0) > 0 ? "waiting" : "completed";
  } finally {
    // Release once no part is left pending (or when the session could not be
    // updated, so it is not stuck behind the lock until the TTL).
    if (!stored || (stored.draft_output?.pending.length ?? 0) === 0) {
      await releaseSessionLock(job);
    }
  }
}

async function generatePart(
  session: Session,
  part: OutputPart,
): Promise<FinalizePartResult> {
  try {
    return part === "client"
      ? { part, view: await generateClientView(session) }
      : { part, view: await generateEngineerView(session) };
  } catch (error) {
    logger.warn("jobs.finalize.failed", {
      sessionId: session.id,
      part,
      message: error instanceof Error ? error.message : "unknown",
    });
    return { part, error };
  }
}

/**
 * Record a finished finalize part on the stored session. When no part is
 * left pending: both views present → finalized; otherwise the failure is
 * kept in last_error and the finished view stays in draft_output, so a
 * retry only regenerates the missing one.
 */
function applyFinalizePart(session: Session, result: FinalizePartResult): Session {
  const draft = session.draft_output ?? {
    client: null,
    engineer: null,
    pending: [result.part],
  };
  const next: DraftOutput = {
    client: "view" in result && result.part === "client" ? result.view : draft.client,
    engineer:
      "view" in result && result.part === "engineer" ? result.view : draft.engineer,
    pending: draft.pending.filter((p) => p !== result.part),
  };
  const now = Date.now();
  const lastError =
    "error" in result
      ? {
          code: result.error instanceof AppError ? result.error.code : "LLM_ERROR",
          message: (result.error instanceof AppError
            ? result.error.message
            : "The AI pipeline failed"
          ).slice(0, 400),
          at: now,
          // Retrying cannot help until the daily budget resets.
          retryable: !(result.error instanceof BudgetExceededError),
        }
      : session.last_error;

  if (next.pending.length > 0) {
    return { ...session, draft_output: next, last_error: lastError, updated_at: now };
  }
  if (next.client && next.engineer) {
    return {
      ...session,
      status: "finalized",
      final_output: { client: next.client, engineer: next.engineer },
      draft_output: null,
      pipeline_stage: null,
      last_error: null,
      updated_at: now,
    };
  }
  return {
    ...session,
    draft_output: next,
    pipeline_stage: null,
    last_error: lastError,
    updated_at: now,
  };
}

async function releaseSessionLock(job: Job): Promise<void> {
  // A failed release is not fatal: the lock expires after its TTL.
  await releaseLock(sessionLockKey(job.sessionId), job.lockToken).catch(
    (err: unknown) => {
      logger.warn("session_lock.release_failure", {
        sessionId: job.sessionId,
        message: err instanceof Error ? err.message : "unknown",
      });
    },
  );
}
