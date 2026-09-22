import "@/lib/server-only";
import { getSession } from "@/lib/storage/session";

/** How often the stream re-reads the session from storage. */
const SESSION_EVENTS_POLL_MS = 1_000;
/** The stream closes after this long, inside the route's 60 s maxDuration. */
const SESSION_EVENTS_MAX_MS = 55_000;
/** Sent as the SSE `retry:` field: the browser reconnects after 1 s. */
const SESSION_EVENTS_RETRY_MS = 1_000;

interface StreamOptions {
  pollMs?: number;
  maxMs?: number;
  /** The request's signal: the stream stops when the browser disconnects. */
  signal?: AbortSignal;
}

/**
 * Server-Sent Events for one session (OPS-01). Sends the session at once,
 * then again whenever its updated_at changes, checking storage every
 * `pollMs`. Closes after `maxMs`; EventSource then reconnects on its own.
 *
 *   event: session   data: <Session JSON>
 *   event: gone      the session expired or was deleted; do not reconnect
 */
export function sessionEventStream(
  sessionId: string,
  {
    pollMs = SESSION_EVENTS_POLL_MS,
    maxMs = SESSION_EVENTS_MAX_MS,
    signal,
  }: StreamOptions = {},
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let stopped = false;
  let wake: (() => void) | null = null;

  const stop = (): void => {
    stopped = true;
    wake?.();
  };

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      signal?.addEventListener("abort", stop, { once: true });
      const send = (text: string): void => {
        if (!stopped) controller.enqueue(encoder.encode(text));
      };

      send(`retry: ${SESSION_EVENTS_RETRY_MS}\n\n`);
      const deadline = Date.now() + maxMs;
      let lastUpdatedAt: number | null = null;

      while (!stopped) {
        const session = await getSession(sessionId);
        if (!session) {
          send("event: gone\ndata: {}\n\n");
          break;
        }
        if (session.updated_at !== lastUpdatedAt) {
          lastUpdatedAt = session.updated_at;
          send(`event: session\ndata: ${JSON.stringify(session)}\n\n`);
        }
        if (Date.now() + pollMs > deadline) break;
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, pollMs);
          wake = () => {
            clearTimeout(timer);
            resolve();
          };
        });
        wake = null;
      }

      signal?.removeEventListener("abort", stop);
      stopped = true;
      try {
        controller.close();
      } catch {
        // Already cancelled by the reader.
      }
    },
    cancel() {
      stop();
    },
  });
}
