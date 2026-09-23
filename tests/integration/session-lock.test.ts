import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as runRoute } from "@/app/api/session/[id]/run/route";
import { POST as answerRoute } from "@/app/api/session/[id]/answer/route";
import { POST as finalizeRoute } from "@/app/api/finalize/route";
import { createSession } from "@/lib/pipeline/orchestrator";
import { getSession, putSession } from "@/lib/storage/session";
import {
  acquireLock,
  JOB_MAX_DURATION_SECONDS,
  releaseLock,
  SESSION_LOCK_TTL_SECONDS,
  sessionLockKey,
} from "@/lib/storage/lock";
import { buildSessionCookie, SESSION_COOKIE_NAME } from "@/lib/security/session-cookie";
import type { Session } from "@/lib/schemas/mcq";
import { startMockLlm, type MockLlm } from "../mocks/mock-llm";
import { drainJobs, failNextSend, queuedJobs, resetJobQueue } from "../mocks/job-queue";
import { makeRound } from "../fixtures/llm";

vi.mock("@/lib/jobs/transport", () => import("../mocks/job-queue"));

let mock: MockLlm;
let ipCounter = 0;

beforeAll(async () => {
  mock = await startMockLlm();
  process.env.GEMINI_BASE_URL = mock.url;
});

afterAll(async () => {
  await mock.close();
});

beforeEach(() => {
  mock.reset();
  resetJobQueue();
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
  it("two concurrent /run calls queue exactly 1 round; the second gets 409", async () => {
    const session = await newSession();

    const [a, b] = await Promise.all([
      runRoute(post(`/api/session/${session.id}/run`, session.id), params(session.id)),
      runRoute(post(`/api/session/${session.id}/run`, session.id), params(session.id)),
    ]);

    expect([a.status, b.status].sort()).toEqual([202, 409]);
    const conflict = a.status === 409 ? a : b;
    const body = (await conflict.json()) as { error: { code: string }; session: Session };
    expect(body.error.code).toBe("IN_PROGRESS");
    expect(body.session.id).toBe(session.id);
    expect(queuedJobs).toHaveLength(1);

    expect(await drainJobs()).toEqual(["completed"]);
    expect(mock.callsFor("submit_extraction")).toHaveLength(1);
    expect(mock.callsFor("generate_clarification_questions")).toHaveLength(1);
  });

  it("hands the lock to the job: /run answers 409 until the job has finished", async () => {
    const session = await newSession();
    const first = await runRoute(
      post(`/api/session/${session.id}/run`, session.id),
      params(session.id),
    );
    expect(first.status).toBe(202);

    const whileQueued = await runRoute(
      post(`/api/session/${session.id}/run`, session.id),
      params(session.id),
    );
    expect(whileQueued.status).toBe(409);

    await drainJobs();
    const again = await runRoute(
      post(`/api/session/${session.id}/run`, session.id),
      params(session.id),
    );
    expect(again.status).toBe(200); // round already done → returned unchanged
    expect(mock.callsFor("submit_extraction")).toHaveLength(1);
  });

  it("releases the lock when the pipeline fails", async () => {
    const session = await newSession();
    mock.failNext(3); // extraction exhausts the SDK's retries

    const res = await runRoute(
      post(`/api/session/${session.id}/run`, session.id),
      params(session.id),
    );
    expect(res.status).toBe(202);
    expect(await drainJobs()).toEqual(["failed"]);
    expect((await getSession(session.id))?.status).toBe("error");

    const token = await acquireLock(sessionLockKey(session.id), 5);
    expect(token).not.toBeNull();
    await releaseLock(sessionLockKey(session.id), token!);
  });

  it("restores the session and releases the lock when the queue refuses the job", async () => {
    const session = await newSession();
    failNextSend();

    const res = await runRoute(
      post(`/api/session/${session.id}/run`, session.id),
      params(session.id),
    );
    expect(res.status).toBe(503);
    expect(await getSession(session.id)).toEqual(session);

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
  it("is the job functions' vercel.json maxDuration plus 30 s", () => {
    const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as {
      functions: Record<string, { maxDuration: number }>;
    };
    // The job endpoint, plus the routes that run jobs in-process via after().
    for (const route of [
      "app/api/jobs/[type]/route.ts",
      "app/api/session/[id]/run/route.ts",
      "app/api/session/[id]/answer/route.ts",
      "app/api/session/[id]/describe/route.ts",
      "app/api/finalize/route.ts",
    ]) {
      expect(vercel.functions[route]?.maxDuration).toBe(JOB_MAX_DURATION_SECONDS);
    }
    expect(SESSION_LOCK_TTL_SECONDS).toBe(JOB_MAX_DURATION_SECONDS + 30);
  });
});
