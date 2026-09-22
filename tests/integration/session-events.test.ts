import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { GET as eventsRoute } from "@/app/api/session/[id]/events/route";
import { sessionEventStream } from "@/lib/storage/session-events";
import { putSession } from "@/lib/storage/session";
import { buildSessionCookie, SESSION_COOKIE_NAME } from "@/lib/security/session-cookie";
import { parseSessionEvent } from "@/lib/api/useSessionEvents";
import type { Session } from "@/lib/schemas/mcq";
import { makeSession } from "../fixtures/llm";

/** OPS-01: GET /api/session/:id/events (Server-Sent Events). */

interface SseEvent {
  event: string;
  data: string;
}

/** Reads SSE frames from a stream, one at a time. */
function sseReader(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const frames: string[] = [];

  return {
    /** The next event frame, or null once the stream has closed. */
    async next(): Promise<SseEvent | null> {
      while (true) {
        const frame = frames.shift();
        if (frame !== undefined) {
          const lines = frame.split("\n");
          const event = lines.find((l) => l.startsWith("event: "))?.slice(7);
          const data = lines.find((l) => l.startsWith("data: "))?.slice(6) ?? "";
          if (event) return { event, data };
          continue; // e.g. the `retry:` frame
        }
        const { value, done } = await reader.read();
        if (done) return null;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        frames.push(...parts);
      }
    },
    cancel: () => reader.cancel(),
  };
}

async function storedSession(
  id: string,
  overrides: Partial<Session> = {},
): Promise<Session> {
  const session = makeSession({ id, updated_at: 1_000, ...overrides });
  await putSession(session);
  return session;
}

describe("sessionEventStream", () => {
  it("sends the session at once, then again whenever updated_at changes", async () => {
    const session = await storedSession("d1b2c3d4-e5f6-4a7b-8c9d-000000000001");
    const events = sseReader(
      sessionEventStream(session.id, { pollMs: 10, maxMs: 2_000 }),
    );

    const first = await events.next();
    expect(first?.event).toBe("session");
    expect(parseSessionEvent(first!.data)).toMatchObject({
      id: session.id,
      pipeline_stage: "extracting",
    });

    await putSession({ ...session, pipeline_stage: "github", updated_at: 2_000 });
    const second = await events.next();
    expect(parseSessionEvent(second!.data)?.pipeline_stage).toBe("github");

    await putSession({ ...session, status: "awaiting_answers", updated_at: 3_000 });
    const third = await events.next();
    expect(parseSessionEvent(third!.data)?.status).toBe("awaiting_answers");
    await events.cancel();
  });

  it("stays quiet while nothing changes and closes after maxMs", async () => {
    const session = await storedSession("d1b2c3d4-e5f6-4a7b-8c9d-000000000002");
    const started = Date.now();
    const events = sseReader(sessionEventStream(session.id, { pollMs: 10, maxMs: 150 }));

    const received: SseEvent[] = [];
    for (let e = await events.next(); e; e = await events.next()) received.push(e);

    expect(received.map((e) => e.event)).toEqual(["session"]);
    expect(Date.now() - started).toBeGreaterThanOrEqual(100);
  });

  it("says 'gone' and closes when the session does not exist", async () => {
    const events = sseReader(
      sessionEventStream("d1b2c3d4-e5f6-4a7b-8c9d-00000000dead", {
        pollMs: 10,
        maxMs: 1_000,
      }),
    );
    expect((await events.next())?.event).toBe("gone");
    expect(await events.next()).toBeNull();
  });

  it("stops when the browser disconnects", async () => {
    const session = await storedSession("d1b2c3d4-e5f6-4a7b-8c9d-000000000003");
    const abort = new AbortController();
    const events = sseReader(
      sessionEventStream(session.id, { pollMs: 10, maxMs: 60_000, signal: abort.signal }),
    );
    expect((await events.next())?.event).toBe("session");
    abort.abort();
    expect(await events.next()).toBeNull();
  });
});

describe("GET /api/session/:id/events", () => {
  function get(id: string, withCookie: boolean, signal?: AbortSignal): NextRequest {
    return new NextRequest(`http://localhost/api/session/${id}/events`, {
      headers: withCookie
        ? { cookie: `${SESSION_COOKIE_NAME}=${buildSessionCookie(id).value}` }
        : {},
      signal,
    });
  }
  const params = (id: string) => ({ params: Promise.resolve({ id }) });

  it("requires ownership of the session", async () => {
    const id = "d1b2c3d4-e5f6-4a7b-8c9d-000000000004";
    await storedSession(id);
    const res = await eventsRoute(get(id, false), params(id));
    expect(res.status).toBe(401);
  });

  it("streams text/event-stream with a 1 s reconnect delay", async () => {
    const id = "d1b2c3d4-e5f6-4a7b-8c9d-000000000005";
    await storedSession(id);
    const abort = new AbortController();

    const res = await eventsRoute(get(id, true, abort.signal), params(id));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("cache-control")).toContain("no-cache");

    const reader = res.body!.getReader();
    const { value } = await reader.read();
    expect(new TextDecoder().decode(value)).toContain("retry: 1000");
    abort.abort();
    await reader.cancel();
  });
});

describe("parseSessionEvent", () => {
  it("returns null for malformed data", () => {
    expect(parseSessionEvent("not json")).toBeNull();
    expect(parseSessionEvent('{"id":"x"}')).toBeNull();
  });
});
