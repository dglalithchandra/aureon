import type { Session } from "@/lib/schemas/mcq";

export const RETRYABLE_ERROR_MESSAGE =
  "The AI service had a problem. Your answers are saved.";

export interface SessionErrorNotice {
  message: string;
  /** Show a Retry button (POST /run resumes from the saved answers). */
  canRetry: boolean;
}

/**
 * What the chat shows for a session whose last round failed. Non-retryable
 * failures (the daily AI budget) show the server's message without Retry.
 */
export function sessionErrorNotice(
  session: Pick<Session, "status" | "last_error"> | null,
): SessionErrorNotice | null {
  if (!session || session.status !== "error") return null;
  const err = session.last_error;
  if (err && !err.retryable) return { message: err.message, canRetry: false };
  return { message: RETRYABLE_ERROR_MESSAGE, canRetry: true };
}
