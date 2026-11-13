import { createHash, createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as jobRoute } from "@/app/api/jobs/[type]/route";
import { POST as finalizeRoute } from "@/app/api/finalize/route";
import { runJob } from "@/lib/jobs/run";
import type { Job } from "@/lib/jobs/types";
import { createSession } from "@/lib/pipeline/orchestrator";
import { getSession, putSession } from "@/lib/storage/session";
import { acquireLock, releaseLock, sessionLockKey } from "@/lib/storage/lock";
import { buildSessionCookie, SESSION_COOKIE_NAME } from "@/lib/security/session-cookie";
import type { Session } from "@/lib/schemas/mcq";
import { startMockLlm, type MockLlm } from "../mocks/mock-llm";
import { drainJobs, queuedJobs, resetJobQueue } from "../mocks/job-queue";
import { makeRound, makeSession } from "../fixtures/llm";

/** OPS-01: the job endpoint (QStash signature) and the job handlers. */

vi.mock("@/lib/jobs/transport", () => import("../mocks/job-queue"));

const CURRENT_KEY = "sig_test_current_0123456789";
const NEXT_KEY = "sig_test_next_0123456789abc";
// getServerEnv() reads these lazily on first use.
process.env.QSTASH_CURRENT_SIGNING_KEY = CURRENT_KEY;
process.env.QSTASH_NEXT_SIGNING_KEY = NEXT_KEY;

let mock: MockLlm;
let ip = 0;

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

/** A QStash-style signature: an HS256 JWT over the body's SHA-256. */
function sign(body: string, key = CURRENT_KEY): string {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = encode({ alg: "HS256", typ: "JWT" });
  const payload = encode({
    iss: "Upstash",
    sub: "http://localhost/api/jobs/round",
    iat: now,
    nbf: now,
    exp: now + 300,
    jti: `jwt_${now}`,
    body: createHash("sha256").update(body).digest("base64url"),
  });
  const signature = createHmac("sha256", key)
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${signature}`;
}

function deliver(type: string, body: string, signature?: string) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (signature) headers["upstash-signature"] = signature;
  const req = new NextRequest(`http://localhost/api/jobs/${type}`, {
    method: "POST",
    headers,
    body,
  });
  return jobRoute(req, { params: Promise.resolve({ type }) });
}

/** A stored new session whose lock is held, as /run leaves it for its job. */
async function lockedNewSession(): Promise<{ session: Session; job: Job }> {
  const session = createSession("We need an internal tool for account managers.");
  await putSession(session);
  const token = await acquireLock(sessionLockKey(session.id), 60);
  if (!token) throw new Error("lock not acquired");
  return { session, job: { type: "round", sessionId: session.id, lockToken: token } };
}

async function lockIsFree(sessionId: string): Promise<boolean> {
  const token = await acquireLock(sessionLockKey(sessionId), 5);
  if (!token) return false;
  await releaseLock(sessionLockKey(sessionId), token);
  return true;
}

describe("POST /api/jobs/[type] (QStash delivery)", () => {
  it("runs a signed round job, stores the result and releases the lock", async () => {
    const { session, job } = await lockedNewSession();
    const body = JSON.stringify(job);

    const res = await deliver("round", body, sign(body));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ outcome: "completed" });

    const stored = await getSession(session.id);
    expect(stored?.status).toBe("awaiting_answers");
    expect(stored?.pipeline_stage).toBeNull();
    expect(await lockIsFree(session.id)).toBe(true);
  });

  it("accepts the next signing key (key rotation)", async () => {
    const { job } = await lockedNewSession();
    const body = JSON.stringify(job);
    const res = await deliver("round", body, sign(body, NEXT_KEY));
    expect(res.status).toBe(200);
  });

  it.each<[string, (body: string) => string | undefined]>([
    ["no signature", () => undefined],
    [
      "a signature made with another key",
      (body) => sign(body, "sig_wrong_key_0123456789"),
    ],
    ["a signature over a different body", () => sign('{"type":"round"}')],
  ])("rejects %s with 401 and runs nothing", async (_label, signatureFor) => {
    const { session, job } = await lockedNewSession();
    const body = JSON.stringify(job);

    const res = await deliver("round", body, signatureFor(body));
    expect(res.status).toBe(401);
    expect(mock.calls).toHaveLength(0);
    expect((await getSession(session.id))?.status).toBe("analyzing");
  });

  it("rejects a signed job sent to another type's endpoint", async () => {
    const { job } = await lockedNewSession();
    const body = JSON.stringify(job);
    const res = await deliver("finalize-client", body, sign(body));
    expect(res.status).toBe(400);
    expect(mock.calls).toHaveLength(0);
  });

  it("answers 404 for an unknown job type", async () => {
    const res = await deliver("delete-everything", "{}", sign("{}"));
    expect(res.status).toBe(404);
  });

  it("skips a second delivery of the same job", async () => {
    const { job } = await lockedNewSession();
    const body = JSON.stringify(job);

    await deliver("round", body, sign(body));
    const again = await deliver("round", body, sign(body));
    expect(await again.json()).toEqual({ outcome: "duplicate" });
    expect(mock.callsFor("submit_extraction")).toHaveLength(1);
  });

  it("skips a job whose lock token no longer owns the session", async () => {
    const { session, job } = await lockedNewSession();
    await releaseLock(sessionLockKey(session.id), job.lockToken);

    expect(await runJob(job)).toBe("stale");
    expect(mock.calls).toHaveLength(0);
  });
});

describe("round job", () => {
  it("stores the failed round and still releases the lock", async () => {
    const { session, job } = await lockedNewSession();
    mock.failNext(3); // extraction exhausts the SDK's retries

    expect(await runJob(job)).toBe("failed");
    expect(await getSession(session.id)).toMatchObject({
      status: "error",
      pipeline_stage: null,
      last_error: { code: "LLM_ERROR", retryable: true },
    });
    expect(await lockIsFree(session.id)).toBe(true);
  });
});

describe("finalize jobs", () => {
  function post(sessionId: string): NextRequest {
    ip++; // distinct client IPs keep the per-route rate limit out of the way
    return new NextRequest("http://localhost/api/finalize", {
      method: "POST",
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${buildSessionCookie(sessionId).value}`,
        "content-type": "application/json",
        "x-forwarded-for": `198.51.103.${ip}`,
      },
      body: JSON.stringify({ sessionId }),
    });
  }

  async function readySession(id: string): Promise<Session> {
    const session = makeSession({
      id,
      status: "ready",
      pipeline_stage: null,
      current_confidence: 82,
      rounds: [makeRound()],
    });
    await putSession(session);
    return session;
  }

  it("queues the two views as separate jobs and saves each one as it lands", async () => {
    const { id } = await readySession("c1b2c3d4-e5f6-4a7b-8c9d-000000000001");

    const res = await finalizeRoute(post(id));
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({
      session: {
        pipeline_stage: "finalizing",
        draft_output: { client: null, engineer: null, pending: ["client", "engineer"] },
      },
    });
    expect(queuedJobs.map((j) => j.type)).toEqual([
      "finalize-client",
      "finalize-engineer",
    ]);
    const [clientJob, engineerJob] = queuedJobs.splice(0);

    // The client view lands first: visible on its own, the lock still held.
    expect(await runJob(clientJob!)).toBe("waiting");
    const halfway = await getSession(id);
    expect(halfway?.pipeline_stage).toBe("finalizing");
    // Computed from the round's parameter states (ARCH-01).
    expect(halfway?.draft_output?.client?.confidence_badge.score).toBe(44);
    expect(halfway?.draft_output?.engineer).toBeNull();
    expect(halfway?.draft_output?.pending).toEqual(["engineer"]);
    expect(halfway?.final_output).toBeNull();
    expect((await finalizeRoute(post(id))).status).toBe(409);

    // The engineer view completes the output and releases the lock.
    expect(await runJob(engineerJob!)).toBe("completed");
    const done = await getSession(id);
    expect(done).toMatchObject({
      status: "finalized",
      pipeline_stage: null,
      draft_output: null,
      last_error: null,
    });
    expect(done?.final_output?.client.confidence_badge.score).toBe(44);
    expect(done?.final_output?.engineer.effort_summary.confidence_band).toBe("±20%");

    const cached = await finalizeRoute(post(id));
    expect(cached.status).toBe(200);
    expect(await cached.json()).toMatchObject({ cached: true });
  });

  it("keeps a finished view when the other fails; a retry only writes the missing one", async () => {
    const { id } = await readySession("c1b2c3d4-e5f6-4a7b-8c9d-000000000002");
    expect((await finalizeRoute(post(id))).status).toBe(202);
    const [clientJob, engineerJob] = queuedJobs.splice(0);

    expect(await runJob(clientJob!)).toBe("waiting");
    mock.failNext(3); // the engineer call exhausts the SDK's retries
    expect(await runJob(engineerJob!)).toBe("failed");

    const failed = await getSession(id);
    expect(failed).toMatchObject({
      status: "ready",
      pipeline_stage: null,
      final_output: null,
      last_error: { code: "LLM_ERROR", retryable: true },
    });
    expect(failed?.draft_output?.client).not.toBeNull();
    expect(failed?.draft_output?.engineer).toBeNull();
    expect(await lockIsFree(id)).toBe(true);

    mock.reset();
    expect((await finalizeRoute(post(id))).status).toBe(202);
    expect(queuedJobs.map((j) => j.type)).toEqual(["finalize-engineer"]);
    expect(await drainJobs()).toEqual(["completed"]);

    expect((await getSession(id))?.status).toBe("finalized");
    expect(mock.callsFor("submit_client_view")).toHaveLength(0);
    expect(mock.callsFor("submit_engineer_view")).toHaveLength(1);
  });
});
