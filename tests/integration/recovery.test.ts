import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as runRoute } from "@/app/api/session/[id]/run/route";
import { POST as answerRoute } from "@/app/api/session/[id]/answer/route";
import { createSession } from "@/lib/pipeline/orchestrator";
import { generateOutput } from "@/lib/pipeline/finalize";
import { getSession, putSession } from "@/lib/storage/session";
import { buildSessionCookie, SESSION_COOKIE_NAME } from "@/lib/security/session-cookie";
import { SessionSchema, type MCQAnswer, type Session } from "@/lib/schemas/mcq";
import { startMockLlm, type MockLlm } from "../mocks/mock-llm";
import { makeExtraction, makeRound, makeSession } from "../fixtures/llm";
import { drainJobs, resetJobQueue } from "../mocks/job-queue";

/** BUG-02 (stuck sessions) and ROB-01 (repair / retry of model output). */

vi.mock("@/lib/jobs/transport", () => import("../mocks/job-queue"));

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

function post(path: string, sessionId: string, body?: unknown): NextRequest {
  ip++; // distinct client IPs keep the per-route rate limit out of the way
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: {
      cookie: `${SESSION_COOKIE_NAME}=${buildSessionCookie(sessionId).value}`,
      "content-type": "application/json",
      "x-forwarded-for": `198.51.102.${ip}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** POST /run, then run the round job it queued (if any), as QStash would. */
async function run(id: string) {
  const res = await runRoute(post(`/api/session/${id}/run`, id), {
    params: Promise.resolve({ id }),
  });
  const body = (await res.json()) as Record<string, unknown>;
  const outcomes = res.status === 202 ? await drainJobs() : [];
  return { status: res.status, body, outcomes };
}

async function stored(id: string): Promise<Session> {
  const s = await getSession(id);
  if (!s) throw new Error("session missing");
  return s;
}

describe("BUG-02: a failed round is saved as 'error' and /run resumes it", () => {
  it("3× HTTP 529 on extraction → status 'error' → POST /run succeeds", async () => {
    const session = createSession("We need an internal tool for account managers.");
    await putSession(session);

    mock.failNext(3); // the first attempt plus both SDK retries
    const failed = await run(session.id);
    expect(failed.status).toBe(202);
    expect(failed.outcomes).toEqual(["failed"]);

    const afterFailure = await stored(session.id);
    expect(afterFailure.status).toBe("error");
    expect(afterFailure.pipeline_stage).toBeNull();
    expect(afterFailure.last_error).toMatchObject({ code: "LLM_ERROR", retryable: true });

    const retried = await run(session.id);
    expect(retried).toMatchObject({ status: 202, outcomes: ["completed"] });
    const recovered = await stored(session.id);
    expect(recovered.status).toBe("awaiting_answers");
    expect(recovered.last_error).toBeNull();
    expect(recovered.rounds).toHaveLength(1);
  });

  it("keeps the submitted answers when the round after them fails", async () => {
    const session = createSession("We need an internal tool for account managers.");
    await putSession(session);
    expect((await run(session.id)).status).toBe(202);
    const round0 = (await stored(session.id)).rounds[0]!;
    const answers: MCQAnswer[] = round0.questions.map((q, i) => ({
      question_id: q.id,
      selected_options: [q.options[0]!],
      custom_text: i === 0 ? "Regional sales managers" : null,
    }));

    mock.failNext(3);
    const res = await answerRoute(
      post(`/api/session/${session.id}/answer`, session.id, { answers }),
      {
        params: Promise.resolve({ id: session.id }),
      },
    );
    expect(res.status).toBe(202);
    expect(await drainJobs()).toEqual(["failed"]);

    const failed = await stored(session.id);
    expect(failed.status).toBe("error");
    expect(failed.rounds[0]!.answers).toEqual(answers);
    expect(failed.enriched_input).toContain("Custom: Regional sales managers");

    mock.reset();
    expect((await run(session.id)).status).toBe(202);
    const resumed = await stored(session.id);
    expect(resumed.rounds).toHaveLength(2);
    expect(mock.callsFor("submit_extraction")[0]?.userText).toContain(
      "Custom: Regional sales managers",
    );
  });

  it("resumes an 'analyzing' session with no progress for over 120 s", async () => {
    const now = Date.now();
    const stuck = makeSession({
      id: "b1b2c3d4-e5f6-4a7b-8c9d-000000000001",
      status: "analyzing",
      pipeline_stage: "github",
      created_at: now - 300_000,
      updated_at: now - 121_000,
    });
    await putSession(stuck);

    expect((await run(stuck.id)).status).toBe(202);
    expect((await stored(stuck.id)).status).toBe("awaiting_answers");
  });

  it("answers 409 for an 'analyzing' session that is still making progress", async () => {
    const now = Date.now();
    const active = makeSession({
      id: "b1b2c3d4-e5f6-4a7b-8c9d-000000000002",
      status: "analyzing",
      pipeline_stage: "github",
      created_at: now - 20_000,
      updated_at: now - 5_000,
    });
    await putSession(active);

    const res = await run(active.id);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: { code: "IN_PROGRESS" } });
    expect(mock.calls).toHaveLength(0);
  });

  it("still returns a finished session unchanged", async () => {
    const done = makeSession({
      id: "b1b2c3d4-e5f6-4a7b-8c9d-000000000003",
      status: "awaiting_answers",
      pipeline_stage: null,
      rounds: [makeRound()],
    });
    await putSession(done);
    expect((await run(done.id)).status).toBe(200);
    expect(mock.calls).toHaveLength(0);
  });
});

describe("ROB-01: model output is repaired or retried", () => {
  it("invalid output once, then valid → success after one retry", async () => {
    const session = createSession("We need an internal tool for account managers.");
    await putSession(session);
    mock.enqueue("submit_extraction", { domain: "Zz", confidence: "high" });

    expect((await run(session.id)).outcomes).toEqual(["completed"]);

    const calls = mock.callsFor("submit_extraction");
    expect(calls).toHaveLength(2);
    expect(calls[1]!.userText).toContain(
      "Your previous submit_extraction call was rejected",
    );
    expect(calls[1]!.userText).toContain("parameters");
    expect((await stored(session.id)).status).toBe("awaiting_answers");
  });

  it("invalid output twice → LLM_ERROR (not a 400), session saved as 'error'", async () => {
    const session = createSession("We need an internal tool for account managers.");
    await putSession(session);
    mock.override("submit_extraction", { domain: "Zz" });

    const res = await run(session.id);
    expect(res.outcomes).toEqual(["failed"]);
    expect(mock.callsFor("submit_extraction")).toHaveLength(2);
    const failed = await stored(session.id);
    expect(failed.status).toBe("error");
    expect(failed.last_error).toMatchObject({ code: "LLM_ERROR", retryable: true });
  });

  it("blocker with clarity 55 → accepted, with 40 remaining a ceiling", async () => {
    const session = createSession("Something for my shop.");
    await putSession(session);
    mock.override(
      "submit_extraction",
      makeExtraction({
        parameters: makeExtraction().parameters.map((p) =>
          p.id === "P-03" ? { ...p, state: "MISSING", evidence: null } : p,
        ),
        blocker: true,
        confidence: 55,
      }),
    );

    expect((await run(session.id)).outcomes).toEqual(["completed"]);
    const result = await stored(session.id);
    expect(result.rounds[0]!.extraction).toMatchObject({ blocker: true, confidence: 55 });
    expect(result.current_confidence).toBe(29);
    expect(mock.callsFor("submit_extraction")).toHaveLength(1);
  });

  it("truncated output (stop_reason max_tokens) is retried once with 1.5× the budget", async () => {
    const session = createSession("We need an internal tool for account managers.");
    await putSession(session);
    mock.truncateNext(1);

    expect((await run(session.id)).outcomes).toEqual(["completed"]);
    const calls = mock.callsFor("submit_extraction");
    expect(calls.map((c) => c.maxTokens)).toEqual([4096, 6144]);
  });

  it("repairs an invalid client view during finalize", async () => {
    const session = SessionSchema.parse(
      makeSession({ status: "ready", pipeline_stage: null, rounds: [makeRound()] }),
    );
    mock.enqueue("submit_client_view", { project_summary: "too short" });

    const output = await generateOutput(session);

    expect(output.client.project_summary.length).toBeGreaterThan(20);
    expect(mock.callsFor("submit_client_view")).toHaveLength(2);
    expect(mock.callsFor("submit_engineer_view")).toHaveLength(1);
  });
});

describe("SessionSchema", () => {
  it("still parses sessions stored before last_error existed", () => {
    const { last_error: _drop, ...legacy } = makeSession();
    expect(SessionSchema.parse(legacy).last_error).toBeNull();
  });

  it("accepts the new 'error' status with a last_error", () => {
    const failed = makeSession({
      status: "error",
      last_error: { code: "LLM_ERROR", message: "boom", at: 1, retryable: true },
    });
    expect(SessionSchema.safeParse(failed).success).toBe(true);
  });
});
