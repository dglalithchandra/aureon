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

/** react-query `refetchInterval` value: a delay in ms, or false to stop. */
export function nextPollInterval(state: PollState): number | false {
  if (isFatalPollStatus(state.errorStatus)) return false;
  if (state.sessionStatus !== "analyzing") return false;
  return pollDelayMs(state.analyzingForMs);
}
