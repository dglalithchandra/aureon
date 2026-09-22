import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST as runRoute } from "@/app/api/session/[id]/run/route";
import { POST as answerRoute } from "@/app/api/session/[id]/answer/route";
import { POST as finalizeRoute } from "@/app/api/finalize/route";
import { createSession } from "@/lib/pipeline/orchestrator";
import { getSession, putSession } from "@/lib/storage/session";
import {
  acquireLock,
  LLM_ROUTE_MAX_DURATION_SECONDS,
  releaseLock,
  SESSION_LOCK_TTL_SECONDS,
  sessionLockKey,
} from "@/lib/storage/lock";
import { buildSessionCookie, SESSION_COOKIE_NAME } from "@/lib/security/session-cookie";
import type { Session } from "@/lib/schemas/mcq";
import { startMockAnthropic, type MockAnthropic } from "../mocks/mock-anthropic";
import { makeRound } from "../fixtures/llm";

let mock: MockAnthropic;
let ipCounter = 0;

beforeAll(async () => {
  mock = await startMockAnthropic();
  process.env.ANTHROPIC_BASE_URL = mock.url;
});

afterAll(async () => {
  await mock.close();
});

beforeEach(() => {
  mock.reset();
});

/** A fresh stored session in `analyzing`, as the chat creates it. */
async function newSession(): Promise<Session> {
  const session = createSession("We need an internal tool for account managers.");
  await putSession(session);
  return session;
}

function post(path: string, sessionId: string, body?: unknown): NextRequest {
  // A distinct client IP per request keeps the per-route rate limit out of the way.
  ipCounter++;
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: {
      cookie: `${SESSION_COOKIE_NAME}=${buildSessionCookie(sessionId).value}`,
      "content-type": "application/json",
      "x-forwarded-for": `198.51.101.${ipCounter}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe("BUG-08: one pipeline per session", () => {
  it("two concurrent /run calls make exactly 1 extraction call; the second gets 409", async () => {
    const session = await newSession();
    mock.setDelay(150); // keep the first request busy while the second arrives

    const [a, b] = await Promise.all([
      runRoute(post(`/api/session/${session.id}/run`, session.id), params(session.id)),
      runRoute(post(`/api/session/${session.id}/run`, session.id), params(session.id)),
    ]);

    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const conflict = a.status === 409 ? a : b;
    const body = (await conflict.json()) as { error: { code: string }; session: Session };
    expect(body.error.code).toBe("IN_PROGRESS");
    expect(body.session.id).toBe(session.id);

    expect(mock.callsFor("submit_extraction")).toHaveLength(1);
    expect(mock.callsFor("generate_clarification_questions")).toHaveLength(1);
  });

  it("releases the lock afterwards, so a later /run is answered normally", async () => {
    const session = await newSession();
    const first = await runRoute(
      post(`/api/session/${session.id}/run`, session.id),
      params(session.id),
    );
    expect(first.status).toBe(200);

    const again = await runRoute(
      post(`/api/session/${session.id}/run`, session.id),
      params(session.id),
    );
    expect(again.status).toBe(200); // round already done → returned unchanged
    expect(mock.callsFor("submit_extraction")).toHaveLength(1);
  });

  it("releases the lock when the pipeline fails", async () => {
    const session = await newSession();
    mock.failNext(3); // extraction exhausts the SDK's retries → 502

    const res = await runRoute(
      post(`/api/session/${session.id}/run`, session.id),
      params(session.id),
    );
    expect(res.status).toBe(502);

    const token = await acquireLock(sessionLockKey(session.id), 5);
    expect(token).not.toBeNull();
    await releaseLock(sessionLockKey(session.id), token!);
  });

  it("answer and finalize also answer 409 while another request holds the lock", async () => {
    const session: Session = {
      ...(await newSession()),
      status: "ready",
      pipeline_stage: null,
      rounds: [makeRound()],
    };
    await putSession(session);
    const token = await acquireLock(sessionLockKey(session.id), 30);
    expect(token).not.toBeNull();

    try {
      const answer = await answerRoute(
        post(`/api/session/${session.id}/answer`, session.id, { answers: [] }),
        params(session.id),
      );
      const finalize = await finalizeRoute(
        post("/api/finalize", session.id, { sessionId: session.id }),
      );

      for (const res of [answer, finalize]) {
        expect(res.status).toBe(409);
        expect(await res.json()).toMatchObject({
          error: { code: "IN_PROGRESS" },
          session: { id: session.id },
        });
      }
      expect(mock.calls).toHaveLength(0);
      expect((await getSession(session.id))?.status).toBe("ready");
    } finally {
      await releaseLock(sessionLockKey(session.id), token!);
    }
  });
});

describe("lock TTL", () => {
  it("is the LLM routes' vercel.json maxDuration plus 30 s", () => {
    const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as {
      functions: Record<string, { maxDuration: number }>;
    };
    for (const route of [
      "app/api/session/[id]/run/route.ts",
      "app/api/session/[id]/answer/route.ts",
      "app/api/finalize/route.ts",
    ]) {
      expect(vercel.functions[route]?.maxDuration).toBe(LLM_ROUTE_MAX_DURATION_SECONDS);
    }
    expect(SESSION_LOCK_TTL_SECONDS).toBe(LLM_ROUTE_MAX_DURATION_SECONDS + 30);
  });
});
