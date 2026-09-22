import { useEffect, useRef, useState } from "react";
import { SessionSchema, type Session } from "@/lib/schemas/mcq";

/** Parse one `session` event from /api/session/:id/events; null if malformed. */
export function parseSessionEvent(data: string): Session | null {
  try {
    const parsed = SessionSchema.safeParse(JSON.parse(data));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Follow a session over Server-Sent Events while `enabled` (OPS-01). Calls
 * `onSession` with every update. Returns whether the stream is connected,
 * so callers poll only while it is not: EventSource missing, the stream
 * dropped and is reconnecting, or the server said the session is gone.
 */
export function useSessionEvents(
  sessionId: string | null,
  enabled: boolean,
  onSession: (session: Session) => void,
): boolean {
  const [connected, setConnected] = useState(false);
  const onSessionRef = useRef(onSession);
  useEffect(() => {
    onSessionRef.current = onSession;
  });

  useEffect(() => {
    if (!sessionId || !enabled || typeof EventSource === "undefined") return;
    const source = new EventSource(`/api/session/${sessionId}/events`);
    source.onopen = () => setConnected(true);
    // The browser reconnects by itself; poll until it does.
    source.onerror = () => setConnected(false);
    source.addEventListener("session", (event) => {
      const session = parseSessionEvent((event as MessageEvent<string>).data);
      if (session) onSessionRef.current(session);
    });
    source.addEventListener("gone", () => {
      source.close();
      setConnected(false);
    });
    return () => {
      source.close();
      setConnected(false);
    };
  }, [sessionId, enabled]);

  return enabled && connected;
}

/**
 * The current time, refreshed every `intervalMs` while `enabled` (0 until
 * the first tick). Used to notice a job that stopped making progress.
 */
export function useNow(enabled: boolean, intervalMs = 15_000): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const tick = (): void => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, intervalMs);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [enabled, intervalMs]);
  return now;
}
