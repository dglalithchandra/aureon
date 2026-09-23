/**
 * Polling schedule for the chat's session query while a round is analyzing:
 * 1.5 s for the first 10 s, then 3 s, then 5 s once it has run for 30 s.
 * A 40-second round costs 16 polls instead of 27 at a flat 1.5 s.
 */

export function pollDelayMs(analyzingForMs: number): number {
  if (analyzingForMs < 10_000) return 1_500;
  if (analyzingForMs < 30_000) return 3_000;
  return 5_000;
}

/** 401/404 mean the session is gone or not ours: polling can never succeed. */
export function isFatalPollStatus(status: number | undefined): boolean {
  return status === 401 || status === 404;
}

/** 429 is transient: show "busy, retrying" and let the next poll try again. */
export function isBusyStatus(status: number | undefined): boolean {
  return status === 429;
}

export interface PollState {
  /** Status of the last session we received, if any. */
  sessionStatus: string | undefined;
  /** HTTP status of the last failed poll, if the query is in error. */
  errorStatus: number | undefined;
  /** How long the session has been analyzing, in ms. */
  analyzingForMs: number;
}

/**
 * After a 409 IN_PROGRESS, show "Already working on it…" for as long as the
 * session is still analyzing (another request owns the round).
 */
export function showAlreadyWorking(
  inProgress: boolean,
  sessionStatus: string | undefined,
): boolean {
  return inProgress && sessionStatus === "analyzing";
}

/** react-query `refetchInterval` value: a delay in ms, or false to stop. */
export function nextPollInterval(state: PollState): number | false {
  if (isFatalPollStatus(state.errorStatus)) return false;
  if (state.sessionStatus !== "analyzing") return false;
  return pollDelayMs(state.analyzingForMs);
}

/**
 * A job still "analyzing" (or "finalizing") with no update for this long has
 * died: its function was killed and the session lock (330 s TTL) has expired,
 * so the user can safely retry. Kept above the lock TTL on purpose.
 */
export const JOB_STALLED_MS = 340_000;

export function isJobStalled(updatedAt: number, now: number): boolean {
  return now - updatedAt > JOB_STALLED_MS;
}

/**
 * "Generate anyway" (UX-02): once a round has been through the pipeline
 * there is enough to write a scope, even with questions outstanding. The
 * document says so — its confidence score is the one the answers would have
 * raised, and the output page shows a "Low confidence draft" banner.
 *
 * Before the first round there is nothing to write from, and a session that
 * is already ready or finalized has the ordinary button instead.
 */
export function canGenerateAnyway(session: {
  status: string;
  rounds: readonly unknown[];
}): boolean {
  if (session.rounds.length < 1) return false;
  return (
    session.status === "awaiting_answers" ||
    session.status === "blocker" ||
    session.status === "needs_input"
  );
}
