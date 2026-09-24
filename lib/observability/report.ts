import "@/lib/server-only";
import { logger } from "@/lib/logger";

/**
 * Where an unexpected failure goes besides the log (OBS-01).
 *
 * The app has no error-tracking vendor baked in, because that is the
 * owner's choice and their bill. Instead it posts a small JSON body to
 * whatever `ERROR_WEBHOOK_URL` names — a Sentry ingest proxy, a Slack
 * incoming webhook, a Vercel log drain, an internal endpoint — and does
 * nothing at all when that is unset, which is the default.
 *
 * What is sent is a shape, never content: the message, the error name, the
 * route, the session id and the request id. Briefs, answers and generated
 * documents stay out of it, exactly as they stay out of the logs.
 */

export interface ErrorContext {
  /** Where it happened: a route path, a job type, a pipeline stage. */
  where: string;
  requestId?: string | null;
  sessionId?: string | null;
  /** Anything else that is a shape, not content. */
  detail?: Record<string, string | number | boolean | null>;
}

/** Never let the reporter's own failure become the failure being reported. */
export async function reportError(err: unknown, context: ErrorContext): Promise<void> {
  const url = process.env.ERROR_WEBHOOK_URL;
  const body = {
    name: err instanceof Error ? err.name : typeof err,
    message: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack?.split("\n").slice(0, 8).join("\n") : null,
    environment: process.env.NODE_ENV ?? "development",
    at: new Date().toISOString(),
    ...context,
  };

  logger.error("error.reported", {
    where: context.where,
    requestId: context.requestId ?? null,
    sessionId: context.sessionId ?? null,
    name: body.name,
    message: body.message,
    ...context.detail,
  });

  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(process.env.ERROR_WEBHOOK_TOKEN
          ? { authorization: `Bearer ${process.env.ERROR_WEBHOOK_TOKEN}` }
          : {}),
      },
      body: JSON.stringify(body),
      // A hanging reporter must not hold a request open.
      signal: AbortSignal.timeout(3_000),
    });
  } catch (reportFailure) {
    logger.warn("error.report_failed", {
      message: reportFailure instanceof Error ? reportFailure.message : "unknown",
    });
  }
}
