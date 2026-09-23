import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as runRoute } from "@/app/api/session/[id]/run/route";
import { POST as answerRoute } from "@/app/api/session/[id]/answer/route";
import { POST as describeRoute } from "@/app/api/session/[id]/describe/route";
import { POST as finalizeRoute } from "@/app/api/finalize/route";
import { createSession } from "@/lib/pipeline/orchestrator";
import { getSession, putSession } from "@/lib/storage/session";
import { buildSessionCookie, SESSION_COOKIE_NAME } from "@/lib/security/session-cookie";
import { SCOPING } from "@/lib/config/scoping";
import { deriveMessages, NEEDS_INPUT_PROMPT } from "@/components/chat/messageDerivation";
import type { Session } from "@/lib/schemas/mcq";
import { startMockLlm, type MockLlm } from "../mocks/mock-llm";
import { drainJobs, resetJobQueue } from "../mocks/job-queue";
import {
  makeClientView,
  makeEngineerView,
  makeExtraction,
  makeParameters,
  makeQuestionsPayload,
  makeRound,
  makeSession,
} from "../fixtures/llm";

/** BUG-05: no scope while the goal (P-01) or core features (P-03) are missing. */

vi.mock("@/lib/jobs/transport", () => import("../mocks/job-queue"));

const RAW = "Something for my shop.";
const blockerExtraction = () =>
  makeExtraction({
    parameters: makeParameters({ "P-01": "MISSING" }),
    blocker: true,
    confidence: 30,
  });

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
  // Every round keeps P-01 MISSING, and the model keeps offering a P-01 question.
  mock.override("submit_extraction", blockerExtraction());
  mock.override("generate_clarification_questions", makeQuestionsPayload(["P-01"]));
});

function post(path: string, sessionId: string, body?: unknown): NextRequest {
  ip++; // distinct client IPs keep the per-route rate limit out of the way
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: {
      cookie: `${SESSION_COOKIE_NAME}=${buildSessionCookie(sessionId).value}`,
      "content-type": "application/json",
      "x-forwarded-for": `198.51.104.${ip}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function stored(id: string): Promise<Session> {
  const s = await getSession(id);
  if (!s) throw new Error("session missing");
  return s;
}

/** A fresh session through round 0, which lands in "blocker". */
async function startBlocked(): Promise<Session> {
  const session = createSession(RAW);
  await putSession(session);
  const res = await runRoute(
    post(`/api/session/${session.id}/run`, session.id),
    params(session.id),
  );
  expect(res.status).toBe(202);
  await drainJobs();
  return stored(session.id);
}

/** Answer the outstanding blocker question, then run the queued round. */
async function answerBlocker(session: Session): Promise<Session> {
  const round = session.rounds[session.rounds.length - 1]!;
  const question = round.questions[0]!;
  const res = await answerRoute(
    post(`/api/session/${session.id}/answer`, session.id, {
      answers: [
        {
          question_id: question.id,
          selected_options: [question.options[0]!],
          custom_text: null,
        },
      ],
    }),
    params(session.id),
  );
  expect(res.status).toBe(202);
  await drainJobs();
  return stored(session.id);
}

function describe_(session: Session, text: string) {
  return describeRoute(
    post(`/api/session/${session.id}/describe`, session.id, { text }),
    params(session.id),
  );
}

function finalize(sessionId: string, override?: boolean) {
  return finalizeRoute(
    post("/api/finalize", sessionId, { sessionId, ...(override ? { override } : {}) }),
  );
}

describe("a blocker round never turns into 'ready'", () => {
  it("re-asks with a new question when the answer left P-01 MISSING", async () => {
    const round0 = await startBlocked();
    expect(round0.status).toBe("blocker");
    expect(round0.rounds[0]!.questions[0]!.parameter_id).toBe("P-01");

    const round1 = await answerBlocker(round0);

    // The audit's probe ended here with status "ready" and no questions.
    expect(round1.status).toBe("blocker");
    expect(round1.rounds).toHaveLength(2);
    const asked = round1.rounds[1]!.questions;
    expect(asked).toHaveLength(1);
    expect(asked[0]!.parameter_id).toBe("P-01");
    expect(asked[0]!.id).not.toBe(round0.rounds[0]!.questions[0]!.id);

    // The second MCQ call told the model its first framing did not work.
    const prompts = mock.callsFor("generate_clarification_questions");
    expect(prompts[0]!.userText).not.toContain("<reframe>");
    expect(prompts[1]!.userText).toContain("<reframe>");
    expect(prompts[1]!.userText).toContain("DIFFERENT wording");
  });

  it("uses the static fallback question when the model offers nothing usable", async () => {
    mock.override("generate_clarification_questions", makeQuestionsPayload(["P-07"]));
    const session = await startBlocked();

    expect(session.status).toBe("blocker");
    expect(session.rounds[0]!.questions[0]).toMatchObject({
      parameter_id: "P-01",
      is_blocker: true,
      question: SCOPING.blockerFallback.question,
    });
  });
});

describe("after blockerMaxRounds blocker rounds", () => {
  it("asks for a fuller description instead of another question", async () => {
    let session = await startBlocked();
    session = await answerBlocker(session); // 2nd blocker round
    session = await answerBlocker(session); // 3rd → needs_input

    expect(session.status).toBe("needs_input");
    expect(session.rounds).toHaveLength(SCOPING.blockerMaxRounds);
    expect(session.rounds[2]!.questions).toEqual([]);
    expect(session.pipeline_stage).toBeNull();

    // The chat asks for the rewrite and unlocks its input box.
    expect(deriveMessages(session).at(-1)).toMatchObject({
      kind: "assistant_message",
      markdown: NEEDS_INPUT_PROMPT,
    });
  });

  it("starts the next round from the old and new text, and counts again", async () => {
    let session = await startBlocked();
    session = await answerBlocker(session);
    session = await answerBlocker(session);
    expect(session.status).toBe("needs_input");

    const description = "It books haircuts for my salon and takes deposits online.";
    const res = await describe_(session, description);
    expect(res.status).toBe(202);
    expect(((await res.json()) as { session: Session }).session.status).toBe("analyzing");
    await drainJobs();
    session = await stored(session.id);

    // The extraction saw the original text and the new description.
    const extractionPrompt = mock.callsFor("submit_extraction").at(-1)!.userText;
    expect(extractionPrompt).toContain(RAW);
    expect(extractionPrompt).toContain(description);
    expect(session.rounds[2]!.added_description).toBe(description);

    // The blocker streak restarted, so the user gets questions again.
    expect(session.status).toBe("blocker");
    expect(session.rounds[3]!.questions).toHaveLength(1);
  });

  it("refuses a description when the session is not waiting for one", async () => {
    const session = await startBlocked();
    const res = await describe_(session, "Some more detail about the shop.");
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });
  });
});

describe("POST /api/finalize while blocked", () => {
  it("returns 400 BLOCKED without override, and runs with it", async () => {
    const session = await startBlocked();

    const refused = await finalize(session.id);
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ error: { code: "BLOCKED" } });
    expect(mock.callsFor("submit_client_view")).toHaveLength(0);

    const forced = await finalize(session.id, true);
    expect(forced.status).toBe(202);
    await drainJobs();
    expect((await stored(session.id)).status).toBe("finalized");
  });

  it("refuses a session stored as 'ready' whose extraction is a blocker", async () => {
    // What the audit's probe produced before this fix.
    const legacy = makeSession({
      id: "f0f0f0f0-0000-4000-8000-000000000001",
      status: "ready",
      pipeline_stage: null,
      rounds: [makeRound({ extraction: blockerExtraction() })],
    });
    await putSession(legacy);

    const res = await finalize(legacy.id);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "BLOCKED" } });
  });
});

describe("the round limit", () => {
  it("never stores more rounds than the schema allows", async () => {
    const used = SCOPING.maxTotalRounds - 1;
    const session = makeSession({
      id: "f0f0f0f0-0000-4000-8000-000000000002",
      status: "needs_input",
      pipeline_stage: null,
      final_output: { client: makeClientView(), engineer: makeEngineerView() },
      rounds: Array.from({ length: used }, (_, i) =>
        makeRound({ round_number: i, extraction: blockerExtraction() }),
      ),
    });
    await putSession(session);

    expect((await describe_(session, "A booking tool for my salon.")).status).toBe(202);
    await drainJobs();

    const full = await stored(session.id);
    expect(full.rounds).toHaveLength(SCOPING.maxTotalRounds);
    // Still blocked, but there is no round left to ask another question in.
    expect(full.status).toBe("needs_input");
    expect(full.rounds.at(-1)!.questions).toEqual([]);

    const res = await describe_(full, "One more attempt at describing it.");
    expect(res.status).toBe(400);
    expect(
      ((await res.json()) as { error: { message: string } }).error.message,
    ).toContain("Start a new scope");
  });
});
